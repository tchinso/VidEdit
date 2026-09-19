/**
 * A self-contained, browser-only image compositor.
 *
 * Mount it in an empty element (normally #overlayTool):
 *   const overlayTool = initImageOverlayTool();
 *
 * The returned controller exposes activate(), resize(), and destroy().  activate()
 * is useful when a parent tab changes from display:none to visible.  A
 * "mio:activate" event on the mount element has the same effect.
 */

const MAX_OVERLAYS = 8;
const EXPORT_MAX_EDGE = 3840;
const PANEL_STORAGE_KEY = "discord-media-overlay-panel-collapsed";
const CONTROLLER_KEY = Symbol("imageOverlayToolController");

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function matrix(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
  return { a, b, c, d, e, f };
}

function multiply(first, second) {
  return {
    a: first.a * second.a + first.c * second.b,
    b: first.b * second.a + first.d * second.b,
    c: first.a * second.c + first.c * second.d,
    d: first.b * second.c + first.d * second.d,
    e: first.a * second.e + first.c * second.f + first.e,
    f: first.b * second.e + first.d * second.f + first.f
  };
}

function invert(value) {
  const determinant = value.a * value.d - value.b * value.c;
  if (!determinant) return matrix();
  const inverseDeterminant = 1 / determinant;
  return {
    a: value.d * inverseDeterminant,
    b: -value.b * inverseDeterminant,
    c: -value.c * inverseDeterminant,
    d: value.a * inverseDeterminant,
    e: (value.c * value.f - value.d * value.e) * inverseDeterminant,
    f: (value.b * value.e - value.a * value.f) * inverseDeterminant
  };
}

function closeImageSource(source) {
  if (!source || typeof source.close !== "function") return;
  try {
    source.close();
  } catch {
    // ImageBitmap.close() is best-effort cleanup.
  }
}

function buildMarkup() {
  const styles = [
    "<style data-mio-style>",
    ".mio-root{--mio-page:#fff8f1;--mio-panel:#fffdf9;--mio-text:#3d2819;--mio-muted:#806a58;--mio-line:#f0d7bf;--mio-soft:#fff0df;--mio-accent:#ef6c16;--mio-accent-deep:#c94d08;--mio-accent-soft:#ffe0c0;--mio-danger:#be3f28;--mio-shadow:0 18px 42px rgba(151,79,25,.12);width:100%;color:var(--mio-text);font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans KR',sans-serif;}",
    ".mio-root *,.mio-root *::before,.mio-root *::after{box-sizing:border-box;}",
    ".mio-root .mio-tool{overflow:hidden;border:1px solid var(--mio-line);border-radius:26px;background:linear-gradient(145deg,#fffdf9 0%,var(--mio-page) 100%);box-shadow:var(--mio-shadow);}",
    ".mio-root .mio-titlebar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px 24px 18px;border-bottom:1px solid rgba(240,215,191,.82);}",
    ".mio-root .mio-title{margin:0;color:var(--mio-text);font-size:1.3rem;line-height:1.25;letter-spacing:-.02em;}",
    ".mio-root .mio-description{margin:5px 0 0;color:var(--mio-muted);font-size:.88rem;}",
    ".mio-root button,.mio-root input{font:inherit;}",
    ".mio-root button{cursor:pointer;}",
    ".mio-root button:disabled{cursor:not-allowed;opacity:.48;}",
    ".mio-root button:focus-visible,.mio-root input:focus-visible,.mio-root .mio-layer:focus-visible{outline:3px solid rgba(239,108,22,.34);outline-offset:2px;}",
    ".mio-root .mio-workspace{display:grid;grid-template-columns:minmax(0,1fr) minmax(285px,344px);gap:18px;padding:18px;}",
    ".mio-root.mio-panel-collapsed .mio-workspace{grid-template-columns:minmax(0,1fr);}",
    ".mio-root.mio-panel-collapsed .mio-panel{display:none;}",
    ".mio-root .mio-stage-card{position:relative;min-width:0;min-height:420px;overflow:hidden;border:1px solid var(--mio-line);border-radius:21px;background:#fffaf5;}",
    ".mio-root .mio-stage{position:absolute;inset:0;overflow:hidden;touch-action:none;background:repeating-conic-gradient(#fffaf5 0 25%,#fff3e8 0 50%) 50%/22px 22px;}",
    ".mio-root .mio-canvas{position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;user-select:none;}",
    ".mio-root .mio-stage-top{position:absolute;z-index:2;inset:12px 12px auto;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;pointer-events:none;}",
    ".mio-root .mio-chip{max-width:72%;padding:6px 10px;border:1px solid rgba(240,215,191,.92);border-radius:999px;background:rgba(255,253,249,.91);color:var(--mio-muted);box-shadow:0 4px 12px rgba(118,68,33,.08);font-size:.74rem;line-height:1.25;backdrop-filter:blur(7px);}",
    ".mio-root .mio-chip--mode{max-width:38%;color:var(--mio-accent-deep);font-weight:700;text-align:right;}",
    ".mio-root .mio-toast{position:absolute;z-index:3;left:50%;bottom:16px;max-width:calc(100% - 32px);padding:9px 13px;transform:translate(-50%,16px);border-radius:999px;background:rgba(61,40,25,.92);color:#fff;font-size:.8rem;opacity:0;pointer-events:none;transition:opacity 160ms ease,transform 160ms ease;}",
    ".mio-root .mio-toast.is-visible{transform:translate(-50%,0);opacity:1;}",
    ".mio-root .mio-panel{display:grid;align-content:start;gap:12px;min-width:0;padding:14px;border:1px solid var(--mio-line);border-radius:21px;background:rgba(255,253,249,.88);}",
    ".mio-root .mio-file-grid,.mio-root .mio-action-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;}",
    ".mio-root .mio-file,.mio-root .mio-button{display:inline-flex;align-items:center;justify-content:center;min-height:43px;padding:9px 10px;border:1px solid var(--mio-line);border-radius:14px;background:#fff;color:var(--mio-text);font-size:.82rem;font-weight:750;text-align:center;transition:transform 120ms ease,border-color 120ms ease,background 120ms ease;}",
    ".mio-root .mio-file{position:relative;overflow:hidden;cursor:pointer;}",
    ".mio-root .mio-file:hover,.mio-root .mio-button:not(:disabled):hover{border-color:#efb477;background:#fffaf5;}",
    ".mio-root .mio-file:active,.mio-root .mio-button:not(:disabled):active{transform:translateY(1px);}",
    ".mio-root .mio-file input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;}",
    ".mio-root .mio-file.is-disabled{cursor:not-allowed;opacity:.48;}",
    ".mio-root .mio-file.is-disabled input{cursor:not-allowed;}",
    ".mio-root .mio-button--primary{border-color:var(--mio-accent);background:linear-gradient(180deg,#fb8a35,var(--mio-accent));color:#fff;box-shadow:0 7px 15px rgba(239,108,22,.24);}",
    ".mio-root .mio-button--primary:not(:disabled):hover{border-color:var(--mio-accent-deep);background:linear-gradient(180deg,#fa8130,var(--mio-accent-deep));}",
    ".mio-root .mio-button--danger{color:var(--mio-danger);background:#fff5f1;border-color:#efb9ac;}",
    ".mio-root .mio-button--locked{color:#8a4319;background:var(--mio-accent-soft);border-color:#efad72;}",
    ".mio-root .mio-button--compact{min-height:36px;padding:7px 10px;font-size:.76rem;}",
    ".mio-root .mio-setting{padding:12px;border:1px solid var(--mio-line);border-radius:16px;background:#fff;}",
    ".mio-root .mio-setting-label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;color:var(--mio-muted);font-size:.77rem;font-weight:700;}",
    ".mio-root .mio-value{flex:none;padding:2px 7px;border-radius:999px;background:var(--mio-soft);color:var(--mio-accent-deep);font-size:.72rem;}",
    ".mio-root .mio-range{width:100%;accent-color:var(--mio-accent);}",
    ".mio-root .mio-layers{overflow:hidden;border:1px solid var(--mio-line);border-radius:16px;background:#fff;}",
    ".mio-root .mio-layers-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 10px 9px;border-bottom:1px solid #f6e5d5;}",
    ".mio-root .mio-layers-title{color:var(--mio-muted);font-size:.78rem;font-weight:800;}",
    ".mio-root .mio-layer-list{display:grid;gap:7px;max-height:232px;overflow:auto;padding:10px;}",
    ".mio-root .mio-layer{display:grid;grid-template-columns:28px minmax(0,1fr) auto auto;align-items:center;gap:7px;padding:7px;border:1px solid var(--mio-line);border-radius:12px;background:#fff;cursor:pointer;}",
    ".mio-root .mio-layer.is-active{border-color:#efa15d;background:#fffaf5;box-shadow:inset 0 0 0 1px rgba(239,108,22,.16);}",
    ".mio-root .mio-layer-index{display:grid;width:28px;height:28px;place-items:center;border-radius:999px;background:var(--mio-soft);color:var(--mio-accent-deep);font-size:.72rem;font-weight:850;}",
    ".mio-root .mio-layer-name{min-width:0;overflow:hidden;color:var(--mio-text);font-size:.76rem;font-weight:700;text-overflow:ellipsis;white-space:nowrap;}",
    ".mio-root .mio-layer-action{min-height:30px;padding:5px 7px;border:1px solid var(--mio-line);border-radius:9px;background:#fff;color:var(--mio-muted);font-size:.69rem;font-weight:750;}",
    ".mio-root .mio-layer-action.is-locked{border-color:#efad72;background:var(--mio-accent-soft);color:#8a4319;}",
    ".mio-root .mio-layer-action--delete{border-color:#efb9ac;background:#fff5f1;color:var(--mio-danger);}",
    ".mio-root .mio-empty{margin:0;padding:13px 8px;border:1px dashed #efcfb1;border-radius:11px;background:#fffaf5;color:var(--mio-muted);font-size:.76rem;text-align:center;}",
    ".mio-root .mio-help{margin:1px 2px 0;color:var(--mio-muted);font-size:.74rem;line-height:1.45;}",
    "@media (max-width:820px){.mio-root .mio-workspace{grid-template-columns:minmax(0,1fr);}.mio-root .mio-stage-card{min-height:clamp(340px,58vh,560px);}.mio-root .mio-panel{grid-template-columns:repeat(2,minmax(0,1fr));}.mio-root .mio-layers,.mio-root .mio-setting,.mio-root .mio-help{grid-column:1 / -1;}}",
    "@media (max-width:520px){.mio-root .mio-titlebar{align-items:flex-start;padding:18px;}.mio-root .mio-workspace{padding:12px;gap:12px;}.mio-root .mio-panel{grid-template-columns:1fr;padding:11px;}.mio-root .mio-stage-card{min-height:360px;}.mio-root .mio-chip{max-width:68%;}.mio-root .mio-chip--mode{max-width:42%;}.mio-root .mio-layer-list{max-height:185px;}}",
    "@media (prefers-reduced-motion:reduce){.mio-root .mio-toast,.mio-root .mio-file,.mio-root .mio-button{transition:none;}}",
    "</style>"
  ].join("");

  const body = [
    "<section class='mio-tool' aria-label='이미지 합성 도구'>",
    "<header class='mio-titlebar'>",
    "<div><h2 class='mio-title'>이미지 합성</h2><p class='mio-description'>이미지를 겹치고 위치·크기·회전을 조정한 뒤 PNG로 저장합니다.</p></div>",
    "<button class='mio-button mio-button--compact' data-mio='panel-toggle' type='button' aria-expanded='true'>도구 접기</button>",
    "</header>",
    "<div class='mio-workspace'>",
    "<section class='mio-stage-card'>",
    "<div class='mio-stage' data-mio='stage'>",
    "<canvas class='mio-canvas' data-mio='canvas' aria-label='이미지 합성 캔버스'></canvas>",
    "<div class='mio-stage-top'><span class='mio-chip' data-mio='status'>원본 이미지를 추가하세요.</span><span class='mio-chip mio-chip--mode' data-mio='mode'>대기</span></div>",
    "<div class='mio-toast' data-mio='toast' role='status' aria-live='polite'></div>",
    "</div>",
    "</section>",
    "<aside class='mio-panel' data-mio='panel' aria-label='이미지 합성 설정'>",
    "<div class='mio-file-grid'>",
    "<label class='mio-file' data-mio='base-label' title='원본 이미지 불러오기'>원본 이미지<input data-mio='base-input' type='file' accept='image/*'></label>",
    "<label class='mio-file' data-mio='overlay-label' title='오버레이 이미지 추가'>레이어 추가<input data-mio='overlay-input' type='file' accept='image/*' multiple></label>",
    "</div>",
    "<div class='mio-action-grid'>",
    "<button class='mio-button' data-mio='reset-view' type='button'>화면 맞춤</button>",
    "<button class='mio-button' data-mio='lock-base' type='button'>원본 잠금: 해제</button>",
    "<button class='mio-button mio-button--danger' data-mio='remove-layer' type='button'>선택 삭제</button>",
    "<button class='mio-button mio-button--primary' data-mio='export' type='button'>PNG 저장</button>",
    "</div>",
    "<div class='mio-setting'>",
    "<div class='mio-setting-label'><span>선택 레이어 불투명도</span><span class='mio-value' data-mio='opacity-value'>-</span></div>",
    "<input class='mio-range' data-mio='opacity' type='range' min='0' max='1' step='0.01' value='1' aria-label='선택 레이어 불투명도'>",
    "</div>",
    "<section class='mio-layers'>",
    "<div class='mio-layers-head'><span class='mio-layers-title' data-mio='layers-title'>레이어 0 / 8</span><button class='mio-button mio-button--compact' data-mio='clear-layers' type='button'>전체 삭제</button></div>",
    "<div class='mio-layer-list' data-mio='layer-list'></div>",
    "</section>",
    "<p class='mio-help'>레이어를 드래그해 이동하세요. 두 손가락으로 확대·축소와 회전을 할 수 있습니다.</p>",
    "</aside>",
    "</div>",
    "</section>"
  ].join("");

  return styles + body;
}

export function initImageOverlayTool(root = document.getElementById("overlayTool"), options = {}) {
  if (typeof root === "string") root = document.querySelector(root);
  if (!root) return null;
  if (root[CONTROLLER_KEY]) return root[CONTROLLER_KEY];

  root.classList.add("mio-root");
  root.innerHTML = buildMarkup();

  const find = (name) => root.querySelector("[data-mio='" + name + "']");
  const els = {
    stage: find("stage"),
    canvas: find("canvas"),
    status: find("status"),
    mode: find("mode"),
    toast: find("toast"),
    panel: find("panel"),
    panelToggle: find("panel-toggle"),
    baseInput: find("base-input"),
    baseLabel: find("base-label"),
    overlayInput: find("overlay-input"),
    overlayLabel: find("overlay-label"),
    resetView: find("reset-view"),
    lockBase: find("lock-base"),
    removeLayer: find("remove-layer"),
    clearLayers: find("clear-layers"),
    exportButton: find("export"),
    opacity: find("opacity"),
    opacityValue: find("opacity-value"),
    layersTitle: find("layers-title"),
    layerList: find("layer-list")
  };

  const context = els.canvas && els.canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!context) {
    root.innerHTML = "<p class='mio-empty'>이 브라우저에서는 이미지 합성 캔버스를 준비할 수 없습니다.</p>";
    return null;
  }

  const state = {
    base: { image: null, width: 0, height: 0, name: "", loaded: false },
    overlays: [],
    activeOverlayId: null,
    nextOverlayId: 1,
    view: { x: 0, y: 0, scale: 1, initialScale: 1, locked: false, initialized: false },
    pointers: new Map(),
    gesture: null,
    displayWidth: 0,
    displayHeight: 0,
    devicePixelRatio: 1,
    pendingFit: false,
    destroyed: false,
    baseRequestId: 0,
    baseGeneration: 0,
    panelCollapsed: false
  };

  const removeListeners = [];
  let toastTimer = 0;
  let resizeObserver = null;

  function listen(target, eventName, handler, listenerOptions) {
    if (!target) return;
    target.addEventListener(eventName, handler, listenerOptions);
    removeListeners.push(() => target.removeEventListener(eventName, handler, listenerOptions));
  }

  function showToast(message, duration = 1900) {
    if (state.destroyed || !els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      if (!state.destroyed) els.toast.classList.remove("is-visible");
    }, duration);
  }

  function updateMode(message) {
    els.mode.textContent = message;
  }

  function getOverlayById(id) {
    return state.overlays.find((overlay) => overlay.id === id) || null;
  }

  function getActiveOverlay() {
    return state.activeOverlayId == null ? null : getOverlayById(state.activeOverlayId);
  }

  function getOverlayIndex(id) {
    return state.overlays.findIndex((overlay) => overlay.id === id);
  }

  function ensureActiveOverlay() {
    if (state.activeOverlayId != null && getOverlayById(state.activeOverlayId)) return;
    state.activeOverlayId = state.overlays.length ? state.overlays[state.overlays.length - 1].id : null;
  }

  function updateStatus() {
    if (!state.base.loaded) {
      els.status.textContent = "원본 이미지를 추가하세요.";
      return;
    }

    const active = getActiveOverlay();
    const activeText = active
      ? "선택 " + (getOverlayIndex(active.id) + 1) + (active.locked ? " · 잠김" : "")
      : "선택한 레이어 없음";
    els.status.textContent = "원본: " + state.base.name + " · " + state.base.width + " × " + state.base.height + " · 레이어 " + state.overlays.length + "개 · " + activeText;
  }

  function updateControls() {
    const hasBase = state.base.loaded;
    const active = getActiveOverlay();
    const atLimit = state.overlays.length >= MAX_OVERLAYS;

    els.overlayInput.disabled = !hasBase || atLimit;
    els.overlayLabel.classList.toggle("is-disabled", !hasBase || atLimit);
    els.removeLayer.disabled = !active;
    els.clearLayers.disabled = state.overlays.length === 0;
    els.exportButton.disabled = !hasBase;
    els.opacity.disabled = !active;
    els.layersTitle.textContent = "레이어 " + state.overlays.length + " / " + MAX_OVERLAYS;

    if (active) {
      els.opacity.value = String(active.opacity);
      els.opacityValue.textContent = Math.round(active.opacity * 100) + "%";
    } else {
      els.opacity.value = "1";
      els.opacityValue.textContent = "-";
    }

    els.lockBase.textContent = "원본 잠금: " + (state.view.locked ? "설정" : "해제");
    els.lockBase.classList.toggle("mio-button--locked", state.view.locked);
  }

  function setPanelCollapsed(collapsed, settings = {}) {
    state.panelCollapsed = Boolean(collapsed);
    root.classList.toggle("mio-panel-collapsed", state.panelCollapsed);
    els.panelToggle.textContent = state.panelCollapsed ? "도구 펼치기" : "도구 접기";
    els.panelToggle.setAttribute("aria-expanded", String(!state.panelCollapsed));

    if (settings.save !== false) {
      try {
        window.localStorage.setItem(PANEL_STORAGE_KEY, String(state.panelCollapsed));
      } catch {
        // Storage can be unavailable in private browsing contexts.
      }
    }

    window.requestAnimationFrame(() => resizeCanvas());
  }

  function screenToBase(point) {
    const scale = state.view.scale || 1;
    return {
      x: (point.x - state.view.x) / scale,
      y: (point.y - state.view.y) / scale
    };
  }

  function overlayMatrix(overlay) {
    const anchorX = overlay.width * overlay.anchorX;
    const anchorY = overlay.height * overlay.anchorY;
    let result = matrix(1, 0, 0, 1, overlay.x, overlay.y);
    const cosine = Math.cos(overlay.rotation);
    const sine = Math.sin(overlay.rotation);
    result = multiply(result, matrix(cosine, sine, -sine, cosine, 0, 0));
    result = multiply(result, matrix(overlay.scale, 0, 0, overlay.scale, 0, 0));
    return multiply(result, matrix(1, 0, 0, 1, -anchorX, -anchorY));
  }

  function getTopOverlayAt(point, includeLocked = false) {
    const basePoint = screenToBase(point);
    for (let index = state.overlays.length - 1; index >= 0; index -= 1) {
      const overlay = state.overlays[index];
      if (!includeLocked && overlay.locked) continue;
      const inverse = invert(overlayMatrix(overlay));
      const x = inverse.a * basePoint.x + inverse.c * basePoint.y + inverse.e;
      const y = inverse.b * basePoint.x + inverse.d * basePoint.y + inverse.f;
      if (x >= 0 && y >= 0 && x <= overlay.width && y <= overlay.height) return overlay;
    }
    return null;
  }

  function fitBaseToStage() {
    if (!state.base.loaded || !state.displayWidth || !state.displayHeight) {
      state.pendingFit = state.base.loaded;
      return false;
    }

    const scale = Math.min(state.displayWidth / state.base.width, state.displayHeight / state.base.height);
    state.view.scale = clamp(scale, 0.02, 50);
    state.view.initialScale = state.view.scale;
    state.view.x = state.displayWidth / 2 - (state.base.width * state.view.scale) / 2;
    state.view.y = state.displayHeight / 2 - (state.base.height * state.view.scale) / 2;
    state.view.initialized = true;
    state.pendingFit = false;
    return true;
  }

  function resetOverlayPlacement(overlay, index = 0) {
    if (!state.base.loaded) return;
    const baseEdge = Math.min(state.base.width, state.base.height);
    const overlayEdge = Math.max(overlay.width, overlay.height);
    overlay.scale = clamp((baseEdge * 0.4) / Math.max(1, overlayEdge), 0.02, 10);
    overlay.rotation = 0;
    const offset = index * baseEdge * 0.035;
    overlay.x = state.base.width * 0.5 + offset;
    overlay.y = state.base.height * 0.5 + offset;
  }

  function drawOverlay(targetContext, overlay) {
    const anchorX = overlay.width * overlay.anchorX;
    const anchorY = overlay.height * overlay.anchorY;
    targetContext.save();
    targetContext.translate(overlay.x, overlay.y);
    targetContext.rotate(overlay.rotation);
    targetContext.scale(overlay.scale, overlay.scale);
    targetContext.translate(-anchorX, -anchorY);
    targetContext.globalAlpha = overlay.opacity;
    targetContext.imageSmoothingEnabled = true;
    targetContext.imageSmoothingQuality = "high";
    targetContext.drawImage(overlay.image, 0, 0, overlay.width, overlay.height);
    targetContext.restore();
  }

  function drawOverlayBounds(targetContext, overlay) {
    const anchorX = overlay.width * overlay.anchorX;
    const anchorY = overlay.height * overlay.anchorY;
    const scale = Math.max(overlay.scale * state.view.scale, 0.001);
    targetContext.save();
    targetContext.translate(overlay.x, overlay.y);
    targetContext.rotate(overlay.rotation);
    targetContext.scale(overlay.scale, overlay.scale);
    targetContext.translate(-anchorX, -anchorY);
    targetContext.globalAlpha = 1;
    targetContext.lineWidth = 1.25 / scale;
    targetContext.strokeStyle = "rgba(239,108,22,.96)";
    targetContext.setLineDash([7 / scale, 5 / scale]);
    targetContext.strokeRect(0, 0, overlay.width, overlay.height);
    targetContext.restore();
  }

  function draw() {
    if (state.destroyed || !state.displayWidth || !state.displayHeight) return;
    context.setTransform(state.devicePixelRatio, 0, 0, state.devicePixelRatio, 0, 0);
    context.clearRect(0, 0, state.displayWidth, state.displayHeight);

    if (!state.base.loaded) {
      context.save();
      context.fillStyle = "rgba(128,106,88,.72)";
      context.font = "700 16px Inter, system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("원본 이미지를 추가하세요.", state.displayWidth / 2, state.displayHeight / 2);
      context.restore();
      return;
    }

    context.save();
    context.translate(state.view.x, state.view.y);
    context.scale(state.view.scale, state.view.scale);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(state.base.image, 0, 0, state.base.width, state.base.height);

    for (const overlay of state.overlays) drawOverlay(context, overlay);
    const active = getActiveOverlay();
    if (active) drawOverlayBounds(context, active);
    context.restore();
  }

  function resizeCanvas() {
    if (state.destroyed) return false;
    const rect = els.stage.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    if (!width || !height) return false;

    const previousWidth = state.displayWidth;
    const previousHeight = state.displayHeight;
    state.devicePixelRatio = clamp(window.devicePixelRatio || 1, 1, 3);
    state.displayWidth = width;
    state.displayHeight = height;
    const canvasWidth = Math.max(1, Math.round(width * state.devicePixelRatio));
    const canvasHeight = Math.max(1, Math.round(height * state.devicePixelRatio));

    if (els.canvas.width !== canvasWidth) els.canvas.width = canvasWidth;
    if (els.canvas.height !== canvasHeight) els.canvas.height = canvasHeight;

    if (state.base.loaded) {
      if (state.pendingFit || !state.view.initialized) {
        fitBaseToStage();
      } else if (previousWidth && previousHeight && (previousWidth !== width || previousHeight !== height)) {
        state.view.x += (width - previousWidth) / 2;
        state.view.y += (height - previousHeight) / 2;
      }
    }

    draw();
    return true;
  }

  function renderLayerList() {
    els.layerList.replaceChildren();
    if (!state.overlays.length) {
      const empty = document.createElement("p");
      empty.className = "mio-empty";
      empty.textContent = "아직 추가한 레이어가 없습니다.";
      els.layerList.append(empty);
      return;
    }

    state.overlays.forEach((overlay, index) => {
      const row = document.createElement("div");
      row.className = "mio-layer";
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", "레이어 " + (index + 1) + ": " + overlay.name);
      if (overlay.id === state.activeOverlayId) row.classList.add("is-active");

      const indexTag = document.createElement("span");
      indexTag.className = "mio-layer-index";
      indexTag.textContent = String(index + 1);

      const name = document.createElement("span");
      name.className = "mio-layer-name";
      name.textContent = overlay.name;

      const lock = document.createElement("button");
      lock.className = "mio-layer-action";
      lock.type = "button";
      lock.dataset.action = "lock";
      lock.textContent = overlay.locked ? "잠김" : "잠금";
      lock.setAttribute("aria-label", "레이어 " + (index + 1) + " 잠금 전환");
      if (overlay.locked) lock.classList.add("is-locked");

      const remove = document.createElement("button");
      remove.className = "mio-layer-action mio-layer-action--delete";
      remove.type = "button";
      remove.dataset.action = "remove";
      remove.textContent = "삭제";
      remove.setAttribute("aria-label", "레이어 " + (index + 1) + " 삭제");

      row.append(indexTag, name, lock, remove);

      const selectLayer = () => setActiveOverlay(overlay.id, true);
      row.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target.closest("button[data-action]") : null;
        if (!target) {
          selectLayer();
          return;
        }
        if (target.dataset.action === "lock") {
          toggleOverlayLock(overlay.id);
        } else if (target.dataset.action === "remove") {
          removeOverlayById(overlay.id);
          showToast("레이어 " + (index + 1) + "을 삭제했습니다.");
        }
      });
      row.addEventListener("keydown", (event) => {
        if (event.target !== row) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectLayer();
        }
      });

      els.layerList.append(row);
    });
  }

  function setActiveOverlay(id, silent = false) {
    state.activeOverlayId = id != null && getOverlayById(id) ? id : null;
    updateStatus();
    renderLayerList();
    updateControls();
    draw();
    if (!silent && state.activeOverlayId == null) showToast("선택한 레이어가 없습니다.");
  }

  function removeOverlayById(id) {
    const index = getOverlayIndex(id);
    if (index < 0) return;
    const removed = state.overlays.splice(index, 1)[0];
    closeImageSource(removed.image);
    ensureActiveOverlay();
    updateStatus();
    renderLayerList();
    updateControls();
    draw();
  }

  function toggleOverlayLock(id) {
    const overlay = getOverlayById(id);
    if (!overlay) return;
    overlay.locked = !overlay.locked;
    const index = getOverlayIndex(id) + 1;
    updateStatus();
    renderLayerList();
    updateControls();
    draw();
    showToast("레이어 " + index + (overlay.locked ? "을 잠갔습니다." : "의 잠금을 해제했습니다."));
  }

  function makeOverlay(loaded, name) {
    return {
      id: state.nextOverlayId++,
      image: loaded.image,
      width: loaded.width,
      height: loaded.height,
      name,
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      opacity: 1,
      anchorX: 0.5,
      anchorY: 0.5,
      locked: false
    };
  }

  async function loadImageFromFile(file) {
    if (!file) return null;

    if (typeof window.createImageBitmap === "function") {
      try {
        const bitmap = await window.createImageBitmap(file, { imageOrientation: "from-image" });
        if (!bitmap.width || !bitmap.height) {
          closeImageSource(bitmap);
          throw new Error("유효하지 않은 이미지 크기입니다.");
        }
        return { image: bitmap, width: bitmap.width, height: bitmap.height };
      } catch {
        // Some browsers do not decode every supported image type with ImageBitmap.
      }
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
        element.src = objectUrl;
      });
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) throw new Error("유효하지 않은 이미지 크기입니다.");
      return { image, width, height };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function onBaseInputChange(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;

    const requestId = ++state.baseRequestId;
    let loaded;
    try {
      loaded = await loadImageFromFile(file);
    } catch (error) {
      showToast(error && error.message ? error.message : "원본 이미지를 불러오지 못했습니다.");
      return;
    }

    if (state.destroyed || requestId !== state.baseRequestId) {
      closeImageSource(loaded.image);
      return;
    }

    closeImageSource(state.base.image);
    state.base = {
      image: loaded.image,
      width: loaded.width,
      height: loaded.height,
      name: file.name || "원본 이미지",
      loaded: true
    };
    state.baseGeneration += 1;
    state.view.initialized = false;
    state.pendingFit = true;
    fitBaseToStage();
    state.overlays.forEach((overlay, index) => resetOverlayPlacement(overlay, index));
    ensureActiveOverlay();
    updateStatus();
    renderLayerList();
    updateControls();
    draw();
    showToast("원본 이미지를 불러왔습니다.");
  }

  async function onOverlayInputChange(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    if (!state.base.loaded) {
      showToast("먼저 원본 이미지를 추가하세요.");
      return;
    }

    const baseGeneration = state.baseGeneration;
    let added = 0;
    for (const file of files) {
      if (state.overlays.length >= MAX_OVERLAYS) {
        showToast("레이어는 최대 " + MAX_OVERLAYS + "개까지 추가할 수 있습니다.");
        break;
      }

      let loaded;
      try {
        loaded = await loadImageFromFile(file);
      } catch (error) {
        showToast((error && error.message) || (file.name + "을 불러오지 못했습니다."));
        continue;
      }

      if (state.destroyed || baseGeneration !== state.baseGeneration) {
        closeImageSource(loaded.image);
        break;
      }

      const overlay = makeOverlay(loaded, file.name || "레이어 이미지");
      state.overlays.push(overlay);
      resetOverlayPlacement(overlay, state.overlays.length - 1);
      state.activeOverlayId = overlay.id;
      added += 1;
    }

    if (!added) return;
    updateStatus();
    renderLayerList();
    updateControls();
    draw();
    showToast(added + "개 레이어를 추가했습니다.");
  }

  function pointFromEvent(event) {
    const rect = els.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pointerGeometry(first, second) {
    return {
      midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
      distance: Math.hypot(second.x - first.x, second.y - first.y),
      angle: Math.atan2(second.y - first.y, second.x - first.x)
    };
  }

  function startSingleGesture(point) {
    const overlay = getTopOverlayAt(point);
    if (overlay) {
      setActiveOverlay(overlay.id, true);
      state.gesture = {
        target: "overlay",
        mode: "drag",
        overlayId: overlay.id,
        start: { basePoint: screenToBase(point), x: overlay.x, y: overlay.y }
      };
      updateMode("레이어 " + (getOverlayIndex(overlay.id) + 1) + " 이동");
      return;
    }

    if (!state.base.loaded || state.view.locked) {
      state.gesture = null;
      updateMode(state.view.locked ? "원본 잠금" : "대기");
      return;
    }

    state.gesture = {
      target: "base",
      mode: "drag",
      start: { point, x: state.view.x, y: state.view.y }
    };
    updateMode("원본 이동");
  }

  function startPinchGesture() {
    const points = Array.from(state.pointers.values());
    if (points.length < 2) return;
    const geometry = pointerGeometry(points[0], points[1]);
    const overlay = getTopOverlayAt(geometry.midpoint);

    if (overlay) {
      setActiveOverlay(overlay.id, true);
      state.gesture = {
        target: "overlay",
        mode: "pinch",
        overlayId: overlay.id,
        start: {
          distance: Math.max(geometry.distance, 0.01),
          angle: geometry.angle,
          baseMidpoint: screenToBase(geometry.midpoint),
          x: overlay.x,
          y: overlay.y,
          scale: overlay.scale,
          rotation: overlay.rotation
        }
      };
      updateMode("레이어 " + (getOverlayIndex(overlay.id) + 1) + " 확대·회전");
      return;
    }

    if (!state.base.loaded || state.view.locked) {
      state.gesture = null;
      updateMode(state.view.locked ? "원본 잠금" : "대기");
      return;
    }

    state.gesture = {
      target: "base",
      mode: "pinch",
      start: {
        distance: Math.max(geometry.distance, 0.01),
        world: screenToBase(geometry.midpoint),
        scale: state.view.scale
      }
    };
    updateMode("원본 확대");
  }

  function onPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    if (state.pointers.size >= 2) return;
    try {
      if (typeof event.pointerId === "number") els.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional.
    }

    state.pointers.set(event.pointerId, pointFromEvent(event));
    if (state.pointers.size === 1) startSingleGesture(pointFromEvent(event));
    if (state.pointers.size === 2) startPinchGesture();
  }

  function onPointerMove(event) {
    if (!state.pointers.has(event.pointerId)) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    state.pointers.set(event.pointerId, point);
    const gesture = state.gesture;
    if (!gesture) return;
    const points = Array.from(state.pointers.values());

    if (gesture.mode === "drag" && points.length === 1) {
      if (gesture.target === "overlay") {
        const overlay = getOverlayById(gesture.overlayId);
        if (!overlay || overlay.locked) return;
        const basePoint = screenToBase(point);
        overlay.x = gesture.start.x + basePoint.x - gesture.start.basePoint.x;
        overlay.y = gesture.start.y + basePoint.y - gesture.start.basePoint.y;
      } else {
        if (state.view.locked) return;
        state.view.x = gesture.start.x + point.x - gesture.start.point.x;
        state.view.y = gesture.start.y + point.y - gesture.start.point.y;
      }
      draw();
      return;
    }

    if (gesture.mode !== "pinch" || points.length !== 2) return;
    const geometry = pointerGeometry(points[0], points[1]);
    if (gesture.target === "overlay") {
      const overlay = getOverlayById(gesture.overlayId);
      if (!overlay || overlay.locked) return;
      const scaleFactor = clamp(geometry.distance / gesture.start.distance, 0.02, 100);
      overlay.scale = clamp(gesture.start.scale * scaleFactor, 0.02, 100);
      overlay.rotation = gesture.start.rotation + geometry.angle - gesture.start.angle;
      const baseMidpoint = screenToBase(geometry.midpoint);
      overlay.x = gesture.start.x + baseMidpoint.x - gesture.start.baseMidpoint.x;
      overlay.y = gesture.start.y + baseMidpoint.y - gesture.start.baseMidpoint.y;
    } else {
      if (state.view.locked) return;
      const scale = clamp(gesture.start.scale * (geometry.distance / gesture.start.distance), 0.02, 50);
      state.view.scale = scale;
      state.view.x = geometry.midpoint.x - gesture.start.world.x * scale;
      state.view.y = geometry.midpoint.y - gesture.start.world.y * scale;
    }
    draw();
  }

  function onPointerUp(event) {
    if (!state.pointers.has(event.pointerId)) return;
    event.preventDefault();
    state.pointers.delete(event.pointerId);
    if (state.pointers.size < 2) state.gesture = null;
    if (!state.pointers.size) updateMode("대기");
  }

  function addTouchFallback() {
    const toPointerEvent = (touch, sourceEvent) => ({
      pointerId: 100000 + touch.identifier,
      clientX: touch.clientX,
      clientY: touch.clientY,
      target: els.canvas,
      preventDefault: () => sourceEvent.preventDefault()
    });

    listen(els.canvas, "touchstart", (event) => {
      event.preventDefault();
      for (const touch of event.changedTouches) onPointerDown(toPointerEvent(touch, event));
    }, { passive: false });
    listen(els.canvas, "touchmove", (event) => {
      event.preventDefault();
      for (const touch of event.changedTouches) onPointerMove(toPointerEvent(touch, event));
    }, { passive: false });
    const stop = (event) => {
      event.preventDefault();
      for (const touch of event.changedTouches) onPointerUp(toPointerEvent(touch, event));
    };
    listen(els.canvas, "touchend", stop, { passive: false });
    listen(els.canvas, "touchcancel", stop, { passive: false });
  }

  function createExportCanvas() {
    const longestEdge = Math.max(state.base.width, state.base.height);
    const exportScale = longestEdge > EXPORT_MAX_EDGE ? EXPORT_MAX_EDGE / longestEdge : 1;
    const width = Math.max(1, Math.round(state.base.width * exportScale));
    const height = Math.max(1, Math.round(state.base.height * exportScale));
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const outputContext = output.getContext("2d", { alpha: true });
    if (!outputContext) throw new Error("내보내기 캔버스를 만들지 못했습니다.");

    outputContext.clearRect(0, 0, width, height);
    outputContext.save();
    outputContext.scale(exportScale, exportScale);
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = "high";
    outputContext.drawImage(state.base.image, 0, 0, state.base.width, state.base.height);
    for (const overlay of state.overlays) drawOverlay(outputContext, overlay);
    outputContext.restore();
    return { output, exportScale, width, height };
  }

  function getExportFileName() {
    const name = (state.base.name || "이미지").replace(/\.[^/.]+$/, "");
    return name + "_합성.png";
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      if (typeof canvas.toBlob !== "function") {
        reject(new Error("이 브라우저에서는 PNG 저장을 지원하지 않습니다."));
        return;
      }
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("PNG 저장에 실패했습니다."));
      }, "image/png");
    });
  }

  function downloadBlob(blob, fileName) {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
  }

  async function exportPng() {
    if (!state.base.loaded) {
      showToast("먼저 원본 이미지를 추가하세요.");
      return;
    }

    els.exportButton.disabled = true;
    try {
      const result = createExportCanvas();
      const blob = await canvasToBlob(result.output);
      const fileName = getExportFileName();
      if (options.downloadOnExport !== false) downloadBlob(blob, fileName);

      const detail = {
        blob,
        fileName,
        width: result.width,
        height: result.height,
        scaled: result.exportScale < 1
      };
      root.dispatchEvent(new CustomEvent("mio:export", { detail, bubbles: true }));
      if (typeof options.onExport === "function") {
        try {
          await options.onExport(detail);
        } catch (error) {
          console.error("이미지 합성 결과 전달 실패", error);
        }
      }

      const sizeText = result.width + " × " + result.height;
      showToast(result.exportScale < 1 ? sizeText + " PNG 저장 완료 · 긴 변 3840px 적용" : sizeText + " PNG 저장 완료");
    } catch (error) {
      showToast((error && error.message) || "PNG 저장에 실패했습니다.");
    } finally {
      if (!state.destroyed) updateControls();
    }
  }

  function activate() {
    if (state.destroyed) return;
    resizeCanvas();
  }

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    window.clearTimeout(toastTimer);
    if (resizeObserver) resizeObserver.disconnect();
    removeListeners.splice(0).forEach((remove) => remove());
    closeImageSource(state.base.image);
    state.overlays.forEach((overlay) => closeImageSource(overlay.image));
    state.overlays = [];
    root.classList.remove("mio-root", "mio-panel-collapsed");
    root.replaceChildren();
    delete root[CONTROLLER_KEY];
  }

  listen(els.baseInput, "change", onBaseInputChange);
  listen(els.overlayInput, "change", onOverlayInputChange);
  listen(els.panelToggle, "click", () => setPanelCollapsed(!state.panelCollapsed));
  listen(els.resetView, "click", () => {
    if (!state.base.loaded) {
      showToast("먼저 원본 이미지를 추가하세요.");
      return;
    }
    fitBaseToStage();
    draw();
    updateMode("대기");
    showToast("화면을 이미지에 맞췄습니다.");
  });
  listen(els.lockBase, "click", () => {
    state.view.locked = !state.view.locked;
    updateControls();
    updateMode(state.view.locked ? "원본 잠금" : "대기");
    showToast(state.view.locked ? "원본 이동과 확대를 잠갔습니다." : "원본 잠금을 해제했습니다.");
  });
  listen(els.removeLayer, "click", () => {
    const active = getActiveOverlay();
    if (!active) {
      showToast("선택한 레이어가 없습니다.");
      return;
    }
    const index = getOverlayIndex(active.id) + 1;
    removeOverlayById(active.id);
    showToast("레이어 " + index + "을 삭제했습니다.");
  });
  listen(els.clearLayers, "click", () => {
    if (!state.overlays.length) return;
    state.overlays.forEach((overlay) => closeImageSource(overlay.image));
    state.overlays = [];
    state.activeOverlayId = null;
    updateStatus();
    renderLayerList();
    updateControls();
    draw();
    showToast("모든 레이어를 삭제했습니다.");
  });
  listen(els.opacity, "input", (event) => {
    const active = getActiveOverlay();
    if (!active) {
      updateControls();
      return;
    }
    active.opacity = clamp(Number(event.target.value || "1"), 0, 1);
    els.opacityValue.textContent = Math.round(active.opacity * 100) + "%";
    draw();
  });
  listen(els.exportButton, "click", exportPng);

  if (window.PointerEvent) {
    listen(els.canvas, "pointerdown", onPointerDown, { passive: false });
    listen(els.canvas, "pointermove", onPointerMove, { passive: false });
    listen(els.canvas, "pointerup", onPointerUp, { passive: false });
    listen(els.canvas, "pointercancel", onPointerUp, { passive: false });
  } else {
    addTouchFallback();
  }
  listen(els.canvas, "gesturestart", (event) => event.preventDefault(), { passive: false });
  listen(els.canvas, "gesturechange", (event) => event.preventDefault(), { passive: false });
  listen(els.canvas, "gestureend", (event) => event.preventDefault(), { passive: false });
  listen(root, "mio:activate", activate);

  try {
    state.panelCollapsed = window.localStorage.getItem(PANEL_STORAGE_KEY) === "true";
  } catch {
    state.panelCollapsed = false;
  }
  setPanelCollapsed(state.panelCollapsed, { save: false });

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(els.stage);
  } else {
    listen(window, "resize", resizeCanvas);
  }

  const controller = { activate, resize: resizeCanvas, destroy, exportPng };
  root[CONTROLLER_KEY] = controller;
  renderLayerList();
  updateStatus();
  updateControls();
  updateMode("대기");
  resizeCanvas();
  return controller;
}

export default initImageOverlayTool;
