/**
 * Local image utilities for the media tools page.
 *
 * This module deliberately uses only browser APIs: selected files are decoded
 * in the page, rendered with Canvas, and downloaded straight back to the user.
 */

const MIT_STYLE_ID = 'mit-image-tools-style';
const MIT_MAX_DIMENSION = 16384;
const MIT_MAX_PIXELS = 100_000_000;

const FORMAT_META = Object.freeze({
  png: { label: 'PNG', extension: 'png', mime: 'image/png' },
  jpeg: { label: 'JPEG', extension: 'jpg', mime: 'image/jpeg' },
  webp: { label: 'WebP', extension: 'webp', mime: 'image/webp' },
  bmp: { label: 'BMP', extension: 'bmp', mime: 'image/bmp' },
  ico: { label: 'ICO', extension: 'ico', mime: 'image/x-icon' },
  cur: { label: 'CUR', extension: 'cur', mime: 'image/x-win-bitmap' },
});

let activeTeardown = null;

/**
 * Mount every image tool into the containers supplied by the main application.
 * Calling this again replaces the previous tool instances and releases preview
 * object URLs from the old instance.
 */
export function initImageTools() {
  activeTeardown?.();
  ensureStyles();

  const cleanups = [];
  const toolInitializers = [
    ['converterTool', initConverterTool],
    ['colorTool', initColorTool],
    ['paddingTool', initPaddingTool],
    ['mergeTool', initMergeTool],
    ['rotateTool', initRotateTool],
    ['resizeTool', initResizeTool],
    ['blurTool', initBlurTool],
  ];

  for (const [id, initializer] of toolInitializers) {
    const container = document.getElementById(id);
    if (container) cleanups.push(initializer(container));
  }

  let destroyed = false;
  const teardown = () => {
    if (destroyed) return;
    destroyed = true;
    cleanups.splice(0).reverse().forEach(cleanup => {
      try {
        cleanup?.();
      } catch (error) {
        console.warn('이미지 도구 정리 중 문제가 발생했습니다.', error);
      }
    });
  };

  activeTeardown = teardown;
  return teardown;
}

function ensureStyles() {
  if (document.getElementById(MIT_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = MIT_STYLE_ID;
  style.textContent = `
    .mit-tool {
      --mit-panel: var(--panel, #fffdfa);
      --mit-panel-raised: var(--panel-raised, #fff6ef);
      --mit-line: var(--line, #f1cdb9);
      --mit-text: var(--text, #3a271c);
      --mit-muted: var(--muted, #7c6252);
      --mit-faint: var(--faint, #a28775);
      --mit-brand: var(--brand, #ef8b49);
      --mit-brand-strong: var(--brand-strong, #df6f2d);
      --mit-good: var(--good, #2c9b67);
      --mit-warn: var(--warn, #b96f12);
      --mit-danger: var(--danger, #cc554b);
      color: var(--mit-text);
      font: inherit;
    }

    .mit-tool *, .mit-tool *::before, .mit-tool *::after { box-sizing: border-box; }
    .mit-tool button, .mit-tool input, .mit-tool select { font: inherit; }
    .mit-tool [hidden] { display: none !important; }
    .mit-tool button:focus-visible, .mit-tool input:focus-visible, .mit-tool select:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--mit-brand) 42%, transparent);
      outline-offset: 2px;
    }

    .mit-tool { display: grid; gap: 14px; }
    .mit-heading { display: grid; gap: 5px; }
    .mit-eyebrow { color: var(--mit-brand-strong); font-size: .76rem; font-weight: 800; letter-spacing: .04em; }
    .mit-title { margin: 0; color: var(--mit-text); font-size: clamp(1.18rem, 2.8vw, 1.45rem); letter-spacing: -.03em; }
    .mit-description { max-width: 760px; margin: 0; color: var(--mit-muted); font-size: .9rem; line-height: 1.58; }

    .mit-card {
      padding: clamp(15px, 3vw, 22px);
      border: 1px solid var(--mit-line);
      border-radius: 22px;
      background: var(--mit-panel);
      box-shadow: 0 10px 28px rgba(121, 66, 27, .06);
    }
    .mit-stack { display: grid; gap: 13px; }
    .mit-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px; }
    .mit-grid-wide { grid-column: 1 / -1; }
    .mit-actions { display: flex; flex-wrap: wrap; gap: 9px; align-items: center; }
    .mit-actions .mit-primary { flex: 1 1 180px; }

    .mit-field { display: grid; gap: 6px; min-width: 0; color: var(--mit-muted); font-size: .82rem; font-weight: 750; }
    .mit-field input:not([type="checkbox"]):not([type="color"]), .mit-field select {
      width: 100%; min-width: 0; min-height: 43px; padding: 9px 11px;
      border: 1px solid var(--mit-line); border-radius: 12px;
      background: var(--mit-panel-raised); color: var(--mit-text);
    }
    .mit-field input[type="color"] {
      width: 100%; min-height: 43px; padding: 4px; border: 1px solid var(--mit-line);
      border-radius: 12px; background: var(--mit-panel-raised); cursor: pointer;
    }
    .mit-check { display: inline-flex; align-items: center; gap: 8px; min-height: 42px; color: var(--mit-muted); font-size: .84rem; font-weight: 700; }
    .mit-check input { inline-size: 18px; block-size: 18px; accent-color: var(--mit-brand-strong); }
    .mit-range-row { display: flex; align-items: center; gap: 10px; }
    .mit-range-row input[type="range"] { width: 100%; accent-color: var(--mit-brand-strong); }
    .mit-value-pill {
      min-width: 56px; padding: 5px 8px; border-radius: 999px;
      background: color-mix(in srgb, var(--mit-brand) 13%, transparent);
      color: var(--mit-brand-strong); font-size: .78rem; font-weight: 800; text-align: center;
    }

    .mit-drop-zone {
      display: grid; place-items: center; min-height: 145px; width: 100%; padding: 20px;
      border: 2px dashed color-mix(in srgb, var(--mit-brand) 58%, var(--mit-line)); border-radius: 18px;
      background: color-mix(in srgb, var(--mit-brand) 7%, var(--mit-panel)); color: var(--mit-text);
      cursor: pointer; text-align: center; transition: border-color .16s ease, background .16s ease, transform .16s ease;
    }
    .mit-drop-zone:hover, .mit-drop-zone.mit-drop-active {
      transform: translateY(-1px); border-color: var(--mit-brand-strong);
      background: color-mix(in srgb, var(--mit-brand) 13%, var(--mit-panel));
    }
    .mit-drop-copy { display: grid; gap: 5px; pointer-events: none; }
    .mit-drop-icon { color: var(--mit-brand-strong); font-size: 1.85rem; line-height: 1; }
    .mit-drop-title { font-size: .98rem; font-weight: 850; }
    .mit-drop-subtitle { color: var(--mit-muted); font-size: .8rem; font-weight: 600; line-height: 1.45; }
    .mit-file-input {
      position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden;
      clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
    }

    .mit-primary, .mit-secondary, .mit-download {
      min-height: 43px; padding: 10px 14px; border-radius: 13px; cursor: pointer;
      font-size: .88rem; font-weight: 820; transition: transform .16s ease, filter .16s ease, background .16s ease;
    }
    .mit-primary { border: 1px solid var(--mit-brand-strong); background: var(--mit-brand-strong); color: #fff; }
    .mit-secondary { border: 1px solid var(--mit-line); background: var(--mit-panel-raised); color: var(--mit-text); }
    .mit-download { border: 1px solid color-mix(in srgb, var(--mit-good) 40%, var(--mit-line)); background: color-mix(in srgb, var(--mit-good) 10%, var(--mit-panel)); color: var(--mit-good); }
    .mit-primary:hover, .mit-secondary:hover, .mit-download:hover { filter: brightness(1.03); transform: translateY(-1px); }
    .mit-primary:disabled, .mit-secondary:disabled, .mit-download:disabled, .mit-drop-zone:disabled { cursor: not-allowed; opacity: .52; transform: none; }

    .mit-status { min-height: 1.35em; margin: 0; color: var(--mit-muted); font-size: .82rem; line-height: 1.5; }
    .mit-status.mit-status-error { color: var(--mit-danger); }
    .mit-status.mit-status-success { color: var(--mit-good); }
    .mit-note { margin: 0; color: var(--mit-faint); font-size: .78rem; line-height: 1.55; }
    .mit-warning { padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--mit-warn) 38%, var(--mit-line)); border-radius: 13px; background: color-mix(in srgb, var(--mit-warn) 9%, var(--mit-panel)); color: var(--mit-warn); font-size: .79rem; line-height: 1.5; }

    .mit-output-list { display: grid; gap: 11px; }
    .mit-result-card { display: grid; grid-template-columns: minmax(82px, 122px) minmax(0, 1fr) auto; gap: 13px; align-items: center; padding: 12px; border: 1px solid var(--mit-line); border-radius: 17px; background: var(--mit-panel-raised); }
    .mit-result-preview { width: 100%; height: 82px; border-radius: 11px; background-color: #f5ece4; background-image: linear-gradient(45deg, #e9ddd2 25%, transparent 25%), linear-gradient(-45deg, #e9ddd2 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e9ddd2 75%), linear-gradient(-45deg, transparent 75%, #e9ddd2 75%); background-position: 0 0, 0 7px, 7px -7px, -7px 0; background-size: 14px 14px; object-fit: contain; }
    .mit-result-copy { min-width: 0; display: grid; gap: 6px; }
    .mit-result-name { overflow: hidden; color: var(--mit-text); font-size: .88rem; font-weight: 850; text-overflow: ellipsis; white-space: nowrap; }
    .mit-result-meta { color: var(--mit-muted); font-size: .76rem; line-height: 1.45; }

    .mit-preview-wrap { min-height: 120px; overflow: auto; padding: 10px; border: 1px solid var(--mit-line); border-radius: 17px; background-color: #f8f1eb; background-image: linear-gradient(45deg, rgba(220, 195, 177, .42) 25%, transparent 25%), linear-gradient(-45deg, rgba(220, 195, 177, .42) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(220, 195, 177, .42) 75%), linear-gradient(-45deg, transparent 75%, rgba(220, 195, 177, .42) 75%); background-position: 0 0, 0 10px, 10px -10px, -10px 0; background-size: 20px 20px; text-align: center; }
    .mit-canvas { display: block; max-width: 100%; max-height: 420px; margin: 0 auto; border-radius: 10px; background: transparent; }
    .mit-empty-preview { display: grid; min-height: 100px; place-items: center; color: var(--mit-faint); font-size: .84rem; }

    .mit-color-list { display: grid; gap: 8px; }
    .mit-color-row { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 9px 10px; border: 1px solid var(--mit-line); border-radius: 13px; background: var(--mit-panel-raised); }
    .mit-swatch { inline-size: 34px; block-size: 34px; border: 1px solid rgba(55, 35, 20, .16); border-radius: 10px; }
    .mit-hex { color: var(--mit-text); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .84rem; font-weight: 800; }
    .mit-color-meta { color: var(--mit-muted); font-size: .75rem; text-align: right; }
    .mit-palette-canvas { display: block; width: 100%; max-height: 180px; border-radius: 13px; }

    @media (max-width: 590px) {
      .mit-grid { grid-template-columns: 1fr; }
      .mit-result-card { grid-template-columns: 1fr; }
      .mit-result-preview { height: 150px; }
      .mit-result-card .mit-download { width: 100%; }
      .mit-actions > button { flex: 1 1 130px; }
    }
  `;
  document.head.append(style);
}

function initConverterTool(container) {
  container.innerHTML = `
    <section class="mit-tool" aria-labelledby="mit-converter-title">
      <div class="mit-heading">
        <span class="mit-eyebrow">LOCAL CONVERSION</span>
        <h2 class="mit-title" id="mit-converter-title">이미지 형식 변환</h2>
        <p class="mit-description">여러 이미지를 한 번에 원하는 형식으로 바꿉니다. 변환과 다운로드는 이 브라우저 안에서만 이루어집니다.</p>
      </div>
      <div class="mit-card mit-stack">
        <button class="mit-drop-zone" type="button" data-mit-role="drop-zone">
          <span class="mit-drop-copy"><span class="mit-drop-icon">⌁</span><span class="mit-drop-title">이미지를 선택하거나 놓으세요</span><span class="mit-drop-subtitle">여러 파일을 선택할 수 있습니다</span></span>
        </button>
        <input class="mit-file-input" data-mit-role="file-input" type="file" accept="image/*,.ico,.cur" multiple aria-label="변환할 이미지 선택">
        <p class="mit-status" data-mit-role="file-status" aria-live="polite">선택된 파일이 없습니다.</p>
        <div class="mit-grid">
          <label class="mit-field">출력 형식
            <select data-mit-role="format">
              <option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option><option value="bmp">BMP</option><option value="ico">ICO</option><option value="cur">CUR</option>
            </select>
          </label>
          <label class="mit-field">품질
            <span class="mit-range-row"><input data-mit-role="quality" type="range" min="40" max="100" value="92"><output class="mit-value-pill" data-mit-role="quality-value">92%</output></span>
          </label>
          <label class="mit-field">JPEG 배경색
            <input data-mit-role="background" type="color" value="#ffffff">
          </label>
          <label class="mit-field">ICO / CUR 크기
            <select data-mit-role="icon-size"><option value="16">16 px</option><option value="32">32 px</option><option value="48">48 px</option><option value="64">64 px</option><option value="128">128 px</option><option value="256" selected>256 px</option></select>
          </label>
        </div>
        <div class="mit-actions"><button class="mit-primary" type="button" data-mit-role="convert" disabled>일괄 변환</button></div>
        <p class="mit-warning">애니메이션 GIF, APNG, Animated WebP는 현재 보이는 첫 프레임만 정적 이미지로 변환됩니다.</p>
        <p class="mit-status" data-mit-role="status" aria-live="polite"></p>
      </div>
      <div class="mit-output-list" data-mit-role="results" aria-live="polite"></div>
    </section>
  `;

  const input = role(container, 'file-input');
  const format = role(container, 'format');
  const quality = role(container, 'quality');
  const qualityValue = role(container, 'quality-value');
  const background = role(container, 'background');
  const iconSize = role(container, 'icon-size');
  const convertButton = role(container, 'convert');
  const fileStatus = role(container, 'file-status');
  const status = role(container, 'status');
  const results = role(container, 'results');
  const state = { files: [], busy: false, previewUrls: [] };

  const revokePreviews = () => {
    state.previewUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
  };
  const updateSelection = files => {
    state.files = files.filter(isImageFile);
    if (!state.files.length) {
      setStatus(fileStatus, '지원되는 이미지 파일을 선택해 주세요.', 'error');
    } else {
      setStatus(fileStatus, `${state.files.length}개 파일 선택됨 · ${formatBytes(state.files.reduce((total, file) => total + file.size, 0))}`, 'success');
    }
    convertButton.disabled = !state.files.length || state.busy;
  };

  const detachDrop = attachDropZone(container, input, updateSelection);
  quality.addEventListener('input', () => { qualityValue.value = `${quality.value}%`; qualityValue.textContent = `${quality.value}%`; });
  format.addEventListener('change', () => {
    const iconOutput = format.value === 'ico' || format.value === 'cur';
    iconSize.closest('.mit-field').hidden = !iconOutput;
    background.closest('.mit-field').hidden = format.value !== 'jpeg';
    quality.closest('.mit-field').hidden = !['jpeg', 'webp'].includes(format.value);
  });
  format.dispatchEvent(new Event('change'));

  convertButton.addEventListener('click', async () => {
    if (state.busy || !state.files.length) return;
    state.busy = true;
    convertButton.disabled = true;
    revokePreviews();
    results.replaceChildren();
    const outputFormat = format.value;
    const meta = FORMAT_META[outputFormat];
    setStatus(status, `0 / ${state.files.length}개 변환 중…`);

    for (let index = 0; index < state.files.length; index += 1) {
      const file = state.files[index];
      try {
        const loaded = await loadImage(file);
        try {
          assertCanvasSize(loaded.width, loaded.height);
          const canvas = makeCanvas(loaded.width, loaded.height);
          canvas.getContext('2d').drawImage(loaded.image, 0, 0);
          const blob = await encodeCanvas(canvas, outputFormat, {
            quality: Number(quality.value) / 100,
            background: background.value,
            iconSize: Number(iconSize.value),
          });
          const previewUrl = URL.createObjectURL(blob);
          state.previewUrls.push(previewUrl);
          const filename = `${fileBaseName(file.name)}_converted.${meta.extension}`;
          results.append(makeConversionResult({ previewUrl, filename, blob, source: file, format: meta }));
        } finally {
          loaded.release();
        }
      } catch (error) {
        results.append(makeErrorResult(file.name, readableError(error)));
      }
      setStatus(status, `${index + 1} / ${state.files.length}개 처리됨`);
      await nextFrame();
    }

    state.busy = false;
    convertButton.disabled = !state.files.length;
    setStatus(status, `${state.files.length}개 파일의 변환을 마쳤습니다.`, 'success');
  });

  return () => {
    detachDrop();
    revokePreviews();
  };
}

function initColorTool(container) {
  container.innerHTML = `
    <section class="mit-tool" aria-labelledby="mit-color-title">
      <div class="mit-heading">
        <span class="mit-eyebrow">COLOR ANALYSIS</span>
        <h2 class="mit-title" id="mit-color-title">대표 색상 분석</h2>
        <p class="mit-description">투명 픽셀을 제외한 이미지의 주요 색상을 HEX로 정리합니다. CSV와 팔레트 PNG도 바로 저장할 수 있습니다.</p>
      </div>
      <div class="mit-card mit-stack">
        <button class="mit-drop-zone" type="button" data-mit-role="drop-zone">
          <span class="mit-drop-copy"><span class="mit-drop-icon">◉</span><span class="mit-drop-title">분석할 이미지를 선택하세요</span><span class="mit-drop-subtitle">한 장의 이미지에서 대표 색상을 찾습니다</span></span>
        </button>
        <input class="mit-file-input" data-mit-role="file-input" type="file" accept="image/*,.ico,.cur" aria-label="색상을 분석할 이미지 선택">
        <p class="mit-status" data-mit-role="file-status" aria-live="polite">이미지를 선택해 주세요.</p>
        <div class="mit-grid">
          <label class="mit-field">분석 해상도
            <span class="mit-range-row"><input data-mit-role="resolution" type="range" min="128" max="1600" step="64" value="768"><output class="mit-value-pill" data-mit-role="resolution-value">768 px</output></span>
          </label>
          <label class="mit-field">표시할 색상 수
            <select data-mit-role="top-count"><option value="5">5개</option><option value="8" selected>8개</option><option value="12">12개</option><option value="16">16개</option></select>
          </label>
        </div>
        <div class="mit-actions"><button class="mit-primary" type="button" data-mit-role="analyze" disabled>색상 분석</button><button class="mit-secondary" type="button" data-mit-role="csv" disabled>CSV 다운로드</button><button class="mit-download" type="button" data-mit-role="palette" disabled>팔레트 PNG</button></div>
        <p class="mit-note">사진처럼 색이 많은 이미지는 비슷한 색을 하나의 색상군으로 묶어, 더 읽기 쉬운 대표 HEX를 만듭니다.</p>
        <p class="mit-status" data-mit-role="status" aria-live="polite"></p>
      </div>
      <div class="mit-card mit-stack" data-mit-role="analysis" hidden>
        <canvas class="mit-palette-canvas" data-mit-role="palette-preview"></canvas>
        <div class="mit-color-list" data-mit-role="color-list"></div>
      </div>
    </section>
  `;

  const input = role(container, 'file-input');
  const resolution = role(container, 'resolution');
  const resolutionValue = role(container, 'resolution-value');
  const topCount = role(container, 'top-count');
  const analyzeButton = role(container, 'analyze');
  const csvButton = role(container, 'csv');
  const paletteButton = role(container, 'palette');
  const fileStatus = role(container, 'file-status');
  const status = role(container, 'status');
  const analysis = role(container, 'analysis');
  const palettePreview = role(container, 'palette-preview');
  const colorList = role(container, 'color-list');
  const state = { file: null, result: null, busy: false };

  const detachDrop = attachDropZone(container, input, files => {
    state.file = files.find(isImageFile) || null;
    state.result = null;
    analysis.hidden = true;
    csvButton.disabled = true;
    paletteButton.disabled = true;
    analyzeButton.disabled = !state.file;
    setStatus(fileStatus, state.file ? `${state.file.name} · ${formatBytes(state.file.size)}` : '지원되는 이미지 파일을 선택해 주세요.', state.file ? 'success' : 'error');
    setStatus(status, '');
  });

  resolution.addEventListener('input', () => {
    resolutionValue.value = `${resolution.value} px`;
    resolutionValue.textContent = `${resolution.value} px`;
  });

  analyzeButton.addEventListener('click', async () => {
    if (!state.file || state.busy) return;
    state.busy = true;
    analyzeButton.disabled = true;
    setStatus(status, '색상을 분석하는 중…');
    try {
      const loaded = await loadImage(state.file);
      try {
        const maxSide = Number(resolution.value);
        const scale = Math.min(1, maxSide / Math.max(loaded.width, loaded.height));
        const width = Math.max(1, Math.round(loaded.width * scale));
        const height = Math.max(1, Math.round(loaded.height * scale));
        assertCanvasSize(width, height);
        const sampleCanvas = makeCanvas(width, height);
        const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
        sampleContext.drawImage(loaded.image, 0, 0, width, height);
        const analyzed = collectDominantColors(sampleContext.getImageData(0, 0, width, height));
        const rows = analyzed.rows.slice(0, Number(topCount.value));
        if (!rows.length) throw new Error('불투명한 픽셀을 찾지 못했습니다.');
        const paletteCanvas = makePaletteCanvas(rows);
        state.result = { rows, paletteCanvas, pixels: analyzed.pixels, bins: analyzed.bins };
        renderColorResults(colorList, rows);
        copyCanvas(paletteCanvas, palettePreview);
        analysis.hidden = false;
        csvButton.disabled = false;
        paletteButton.disabled = false;
        setStatus(status, `${analyzed.pixels.toLocaleString()}개 픽셀을 분석해 ${rows.length}개의 대표 색상을 찾았습니다.`, 'success');
      } finally {
        loaded.release();
      }
    } catch (error) {
      setStatus(status, readableError(error), 'error');
    } finally {
      state.busy = false;
      analyzeButton.disabled = !state.file;
    }
  });

  csvButton.addEventListener('click', () => {
    if (!state.result || !state.file) return;
    const lines = ['rank,hex,pixels,percent'];
    state.result.rows.forEach((row, index) => lines.push([index + 1, row.hex, row.count, row.percent.toFixed(4)].join(',')));
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `${fileBaseName(state.file.name)}_colors.csv`);
  });

  paletteButton.addEventListener('click', async () => {
    if (!state.result || !state.file) return;
    const blob = await canvasToBlob(state.result.paletteCanvas, 'image/png');
    downloadBlob(blob, `${fileBaseName(state.file.name)}_palette.png`);
  });

  return detachDrop;
}

function initPaddingTool(container) {
  container.innerHTML = `
    <section class="mit-tool" aria-labelledby="mit-padding-title">
      <div class="mit-heading">
        <span class="mit-eyebrow">BOTTOM CANVAS</span>
        <h2 class="mit-title" id="mit-padding-title">하단 여백 추가 · 제거</h2>
        <p class="mit-description">이미지의 아래쪽에 여백을 더하거나, 필요한 만큼 아래쪽을 잘라냅니다.</p>
      </div>
      <div class="mit-card mit-stack">
        <button class="mit-drop-zone" type="button" data-mit-role="drop-zone">
          <span class="mit-drop-copy"><span class="mit-drop-icon">↧</span><span class="mit-drop-title">이미지를 선택하세요</span><span class="mit-drop-subtitle">하단 여백을 만들거나 제거합니다</span></span>
        </button>
        <input class="mit-file-input" data-mit-role="file-input" type="file" accept="image/*,.ico,.cur" aria-label="하단 여백을 수정할 이미지 선택">
        <p class="mit-status" data-mit-role="file-status" aria-live="polite">이미지를 선택해 주세요.</p>
        <div class="mit-grid">
          <label class="mit-field">작업
            <select data-mit-role="operation"><option value="add">아래 여백 추가</option><option value="remove">아래쪽 잘라내기</option></select>
          </label>
          <label class="mit-field">크기
            <input data-mit-role="amount" type="number" min="1" value="120" inputmode="numeric">
          </label>
          <label class="mit-field">단위
            <select data-mit-role="unit"><option value="px">픽셀</option><option value="percent">원본 높이의 %</option></select>
          </label>
          <label class="mit-field">여백 색
            <input data-mit-role="color" type="color" value="#ffffff">
          </label>
        </div>
        <label class="mit-check"><input data-mit-role="transparent" type="checkbox"> PNG 여백을 투명하게</label>
        <div class="mit-actions"><button class="mit-primary" type="button" data-mit-role="apply" disabled>미리보기 만들기</button><button class="mit-download" type="button" data-mit-role="png" disabled>PNG 다운로드</button><button class="mit-download" type="button" data-mit-role="jpeg" disabled>JPG 다운로드</button></div>
        <p class="mit-status" data-mit-role="status" aria-live="polite"></p>
      </div>
      <div class="mit-preview-wrap" data-mit-role="preview"><div class="mit-empty-preview">결과 미리보기가 여기에 표시됩니다.</div></div>
    </section>
  `;

  const input = role(container, 'file-input');
  const operation = role(container, 'operation');
  const amount = role(container, 'amount');
  const unit = role(container, 'unit');
  const color = role(container, 'color');
  const transparent = role(container, 'transparent');
  const applyButton = role(container, 'apply');
  const pngButton = role(container, 'png');
  const jpegButton = role(container, 'jpeg');
  const fileStatus = role(container, 'file-status');
  const status = role(container, 'status');
  const preview = role(container, 'preview');
  const state = { file: null, canvas: null };

  const detachDrop = attachDropZone(container, input, files => {
    state.file = files.find(isImageFile) || null;
    state.canvas = null;
    clearPreview(preview, '결과 미리보기가 여기에 표시됩니다.');
    setDisabled([applyButton, pngButton, jpegButton], !state.file);
    pngButton.disabled = true;
    jpegButton.disabled = true;
    setStatus(fileStatus, state.file ? `${state.file.name} · ${formatBytes(state.file.size)}` : '지원되는 이미지 파일을 선택해 주세요.', state.file ? 'success' : 'error');
    setStatus(status, '');
  });

  applyButton.addEventListener('click', async () => {
    if (!state.file) return;
    applyButton.disabled = true;
    setStatus(status, '미리보기를 만드는 중…');
    try {
      const loaded = await loadImage(state.file);
      try {
        const rawAmount = Math.round(Number(amount.value));
        if (!Number.isFinite(rawAmount) || rawAmount < 1) throw new Error('크기는 1 이상의 숫자로 입력해 주세요.');
        const pixels = unit.value === 'percent' ? Math.round(loaded.height * rawAmount / 100) : rawAmount;
        if (operation.value === 'remove' && pixels >= loaded.height) throw new Error('제거할 크기는 원본 높이보다 작아야 합니다.');
        const outputHeight = operation.value === 'add' ? loaded.height + pixels : loaded.height - pixels;
        assertCanvasSize(loaded.width, outputHeight);
        const canvas = makeCanvas(loaded.width, outputHeight);
        const context = canvas.getContext('2d');
        if (operation.value === 'add') {
          if (!transparent.checked) {
            context.fillStyle = color.value;
            context.fillRect(0, 0, canvas.width, canvas.height);
          }
          context.drawImage(loaded.image, 0, 0);
        } else {
          context.drawImage(loaded.image, 0, 0);
        }
        state.canvas = canvas;
        showCanvas(preview, canvas);
        pngButton.disabled = false;
        jpegButton.disabled = false;
        const message = operation.value === 'add'
          ? `${loaded.width} × ${pixels}px 하단 여백을 추가했습니다. 결과: ${canvas.width} × ${canvas.height}px`
          : `아래쪽 ${pixels}px을 제거했습니다. 결과: ${canvas.width} × ${canvas.height}px`;
        setStatus(status, message, 'success');
      } finally {
        loaded.release();
      }
    } catch (error) {
      setStatus(status, readableError(error), 'error');
    } finally {
      applyButton.disabled = !state.file;
    }
  });

  pngButton.addEventListener('click', async () => {
    if (!state.canvas || !state.file) return;
    downloadBlob(await canvasToBlob(state.canvas, 'image/png'), `${fileBaseName(state.file.name)}_bottom.png`);
  });
  jpegButton.addEventListener('click', async () => {
    if (!state.canvas || !state.file) return;
    const blob = await canvasToBlob(flattenCanvas(state.canvas, color.value), 'image/jpeg', .92);
    downloadBlob(blob, `${fileBaseName(state.file.name)}_bottom.jpg`);
  });

  return detachDrop;
}

function initMergeTool(container) {
  container.innerHTML = `
    <section class="mit-tool" aria-labelledby="mit-merge-title">
      <div class="mit-heading">
        <span class="mit-eyebrow">IMAGE COMBINE</span>
        <h2 class="mit-title" id="mit-merge-title">이미지 이어 붙이기</h2>
        <p class="mit-description">선택한 순서대로 여러 이미지를 가로 또는 세로로 연결합니다. 접하는 면의 크기도 원하는 방식으로 맞출 수 있습니다.</p>
      </div>
      <div class="mit-card mit-stack">
        <button class="mit-drop-zone" type="button" data-mit-role="drop-zone">
          <span class="mit-drop-copy"><span class="mit-drop-icon">⊞</span><span class="mit-drop-title">두 장 이상의 이미지를 선택하세요</span><span class="mit-drop-subtitle">선택한 순서대로 결과에 배치됩니다</span></span>
        </button>
        <input class="mit-file-input" data-mit-role="file-input" type="file" accept="image/*,.ico,.cur" multiple aria-label="이어 붙일 이미지 선택">
        <p class="mit-status" data-mit-role="file-status" aria-live="polite">두 장 이상의 이미지를 선택해 주세요.</p>
        <div class="mit-grid">
          <label class="mit-field">방향
            <select data-mit-role="direction"><option value="vertical">세로로 연결</option><option value="horizontal">가로로 연결</option></select>
          </label>
          <label class="mit-field">맞춤 방식
            <select data-mit-role="fit"><option value="none">원본 크기 유지</option><option value="min">가장 짧은 쪽에 맞춤</option><option value="max" selected>가장 긴 쪽에 맞춤</option></select>
          </label>
          <label class="mit-field mit-grid-wide">JPG 배경색
            <input data-mit-role="background" type="color" value="#ffffff">
          </label>
        </div>
        <p class="mit-note">가로 연결은 높이를, 세로 연결은 너비를 기준으로 맞춥니다. PNG 결과는 비어 있는 부분을 투명하게 유지합니다.</p>
        <div class="mit-actions"><button class="mit-primary" type="button" data-mit-role="render" disabled>미리보기 만들기</button><button class="mit-download" type="button" data-mit-role="png" disabled>PNG 다운로드</button><button class="mit-download" type="button" data-mit-role="jpeg" disabled>JPG 다운로드</button></div>
        <p class="mit-status" data-mit-role="status" aria-live="polite"></p>
      </div>
      <div class="mit-preview-wrap" data-mit-role="preview"><div class="mit-empty-preview">결과 미리보기가 여기에 표시됩니다.</div></div>
    </section>
  `;

  const input = role(container, 'file-input');
  const direction = role(container, 'direction');
  const fit = role(container, 'fit');
  const background = role(container, 'background');
  const renderButton = role(container, 'render');
  const pngButton = role(container, 'png');
  const jpegButton = role(container, 'jpeg');
  const fileStatus = role(container, 'file-status');
  const status = role(container, 'status');
  const preview = role(container, 'preview');
  const state = { files: [], canvas: null };

  const detachDrop = attachDropZone(container, input, files => {
    state.files = files.filter(isImageFile);
    state.canvas = null;
    clearPreview(preview, '결과 미리보기가 여기에 표시됩니다.');
    renderButton.disabled = state.files.length < 2;
    pngButton.disabled = true;
    jpegButton.disabled = true;
    setStatus(fileStatus, state.files.length >= 2 ? `${state.files.length}개 파일 선택됨 · 선택 순서대로 연결합니다.` : '두 장 이상의 지원되는 이미지 파일을 선택해 주세요.', state.files.length >= 2 ? 'success' : 'error');
    setStatus(status, '');
  });

  renderButton.addEventListener('click', async () => {
    if (state.files.length < 2) return;
    renderButton.disabled = true;
    setStatus(status, '이미지를 이어 붙이는 중…');
    let loadedImages = [];
    try {
      loadedImages = await Promise.all(state.files.map(loadImage));
      const layout = makeMergeLayout(loadedImages, direction.value, fit.value);
      assertCanvasSize(layout.width, layout.height);
      const canvas = makeCanvas(layout.width, layout.height);
      const context = canvas.getContext('2d');
      layout.placements.forEach(placement => {
        context.drawImage(placement.image.image, placement.x, placement.y, placement.width, placement.height);
      });
      state.canvas = canvas;
      showCanvas(preview, canvas);
      pngButton.disabled = false;
      jpegButton.disabled = false;
      setStatus(status, `${state.files.length}개 이미지 연결 완료 · ${canvas.width} × ${canvas.height}px`, 'success');
    } catch (error) {
      setStatus(status, readableError(error), 'error');
    } finally {
      loadedImages.forEach(loaded => loaded.release());
      renderButton.disabled = state.files.length < 2;
    }
  });

  pngButton.addEventListener('click', async () => {
    if (!state.canvas) return;
    downloadBlob(await canvasToBlob(state.canvas, 'image/png'), 'merged-image.png');
  });
  jpegButton.addEventListener('click', async () => {
    if (!state.canvas) return;
    downloadBlob(await canvasToBlob(flattenCanvas(state.canvas, background.value), 'image/jpeg', .92), 'merged-image.jpg');
  });

  return detachDrop;
}

function initRotateTool(container) {
  container.innerHTML = `
    <section class="mit-tool" aria-labelledby="mit-rotate-title">
      <div class="mit-heading">
        <span class="mit-eyebrow">FREE ROTATION</span>
        <h2 class="mit-title" id="mit-rotate-title">이미지 회전</h2>
        <p class="mit-description">원하는 각도로 돌리고, 빈 영역을 투명하게 두거나 단색으로 채울 수 있습니다.</p>
      </div>
      <div class="mit-card mit-stack">
        <button class="mit-drop-zone" type="button" data-mit-role="drop-zone">
          <span class="mit-drop-copy"><span class="mit-drop-icon">⟳</span><span class="mit-drop-title">회전할 이미지를 선택하세요</span><span class="mit-drop-subtitle">슬라이더를 움직이면 미리보기가 바뀝니다</span></span>
        </button>
        <input class="mit-file-input" data-mit-role="file-input" type="file" accept="image/*,.ico,.cur" aria-label="회전할 이미지 선택">
        <p class="mit-status" data-mit-role="file-status" aria-live="polite">이미지를 선택해 주세요.</p>
        <div class="mit-grid">
          <label class="mit-field mit-grid-wide">각도
            <span class="mit-range-row"><input data-mit-role="angle-range" type="range" min="-180" max="180" step="1" value="0"><output class="mit-value-pill" data-mit-role="angle-value">0°</output><input data-mit-role="angle-number" type="number" min="-180" max="180" step="1" value="0" aria-label="회전 각도"></span>
          </label>
          <label class="mit-field">빈 영역
            <select data-mit-role="background-mode"><option value="transparent">투명하게 유지</option><option value="fill">단색으로 채우기</option></select>
          </label>
          <label class="mit-field">배경색
            <input data-mit-role="background-color" type="color" value="#ffffff">
          </label>
        </div>
        <div class="mit-actions"><button class="mit-secondary" type="button" data-mit-role="reset" disabled>0°로 되돌리기</button><button class="mit-download" type="button" data-mit-role="png" disabled>PNG 다운로드</button><button class="mit-download" type="button" data-mit-role="jpeg" disabled>JPG 다운로드</button></div>
        <p class="mit-status" data-mit-role="status" aria-live="polite"></p>
      </div>
      <div class="mit-preview-wrap" data-mit-role="preview"><div class="mit-empty-preview">결과 미리보기가 여기에 표시됩니다.</div></div>
    </section>
  `;

  const input = role(container, 'file-input');
  const angleRange = role(container, 'angle-range');
  const angleNumber = role(container, 'angle-number');
  const angleValue = role(container, 'angle-value');
  const backgroundMode = role(container, 'background-mode');
  const backgroundColor = role(container, 'background-color');
  const resetButton = role(container, 'reset');
  const pngButton = role(container, 'png');
  const jpegButton = role(container, 'jpeg');
  const fileStatus = role(container, 'file-status');
  const status = role(container, 'status');
  const preview = role(container, 'preview');
  const state = { file: null, image: null, canvas: null, drawing: 0 };

  const setAngle = value => {
    const normalized = clamp(Math.round(Number(value) || 0), -180, 180);
    angleRange.value = String(normalized);
    angleNumber.value = String(normalized);
    angleValue.value = `${normalized}°`;
    angleValue.textContent = `${normalized}°`;
  };
  const draw = () => {
    state.drawing = 0;
    if (!state.image) return;
    try {
      const degrees = Number(angleRange.value);
      const radians = degrees * Math.PI / 180;
      const width = Math.max(1, Math.ceil(Math.abs(state.image.width * Math.cos(radians)) + Math.abs(state.image.height * Math.sin(radians))));
      const height = Math.max(1, Math.ceil(Math.abs(state.image.width * Math.sin(radians)) + Math.abs(state.image.height * Math.cos(radians))));
      assertCanvasSize(width, height);
      const canvas = makeCanvas(width, height);
      const context = canvas.getContext('2d');
      if (backgroundMode.value === 'fill') {
        context.fillStyle = backgroundColor.value;
        context.fillRect(0, 0, width, height);
      }
      context.translate(width / 2, height / 2);
      context.rotate(radians);
      context.drawImage(state.image.image, -state.image.width / 2, -state.image.height / 2);
      state.canvas = canvas;
      showCanvas(preview, canvas);
      pngButton.disabled = false;
      jpegButton.disabled = false;
      setStatus(status, `${degrees}° 회전 · ${width} × ${height}px`, 'success');
    } catch (error) {
      setStatus(status, readableError(error), 'error');
    }
  };
  const queueDraw = () => {
    if (!state.image || state.drawing) return;
    state.drawing = requestAnimationFrame(draw);
  };
  const detachDrop = attachDropZone(container, input, async files => {
    const file = files.find(isImageFile);
    if (!file) {
      setStatus(fileStatus, '지원되는 이미지 파일을 선택해 주세요.', 'error');
      return;
    }
    setStatus(fileStatus, '이미지를 불러오는 중…');
    try {
      state.image?.release();
      state.image = await loadImage(file);
      state.file = file;
      state.canvas = null;
      setAngle(0);
      resetButton.disabled = false;
      setStatus(fileStatus, `${file.name} · ${state.image.width} × ${state.image.height}px`, 'success');
      draw();
    } catch (error) {
      setStatus(fileStatus, readableError(error), 'error');
    }
  });

  angleRange.addEventListener('input', () => { setAngle(angleRange.value); queueDraw(); });
  angleNumber.addEventListener('input', () => { setAngle(angleNumber.value); queueDraw(); });
  backgroundMode.addEventListener('change', queueDraw);
  backgroundColor.addEventListener('input', () => { if (backgroundMode.value === 'fill') queueDraw(); });
  resetButton.addEventListener('click', () => { setAngle(0); queueDraw(); });
  pngButton.addEventListener('click', async () => {
    if (!state.canvas || !state.file) return;
    downloadBlob(await canvasToBlob(state.canvas, 'image/png'), `${fileBaseName(state.file.name)}_rotated.png`);
  });
  jpegButton.addEventListener('click', async () => {
    if (!state.canvas || !state.file) return;
    downloadBlob(await canvasToBlob(flattenCanvas(state.canvas, backgroundColor.value), 'image/jpeg', .92), `${fileBaseName(state.file.name)}_rotated.jpg`);
  });

  return () => {
    detachDrop();
    state.image?.release();
    if (state.drawing) cancelAnimationFrame(state.drawing);
  };
}

function initResizeTool(container) {
  container.innerHTML = `
    <section class="mit-tool" aria-labelledby="mit-resize-title">
      <div class="mit-heading">
        <span class="mit-eyebrow">SMART RESIZE</span>
        <h2 class="mit-title" id="mit-resize-title">이미지 크기 조절</h2>
        <p class="mit-description">가로 또는 세로를 바꾸면 비율을 유지한 채 반대쪽 크기를 맞춥니다. 축소 시에는 여러 단계로 리샘플링해 선명도를 지킵니다.</p>
      </div>
      <div class="mit-card mit-stack">
        <button class="mit-drop-zone" type="button" data-mit-role="drop-zone">
          <span class="mit-drop-copy"><span class="mit-drop-icon">↔</span><span class="mit-drop-title">크기를 조절할 이미지를 선택하세요</span><span class="mit-drop-subtitle">가로와 세로 픽셀을 직접 입력할 수 있습니다</span></span>
        </button>
        <input class="mit-file-input" data-mit-role="file-input" type="file" accept="image/*,.ico,.cur" aria-label="크기를 조절할 이미지 선택">
        <p class="mit-status" data-mit-role="file-status" aria-live="polite">이미지를 선택해 주세요.</p>
        <div class="mit-grid">
          <label class="mit-field">가로 (px)<input data-mit-role="width" type="number" min="1" inputmode="numeric" disabled></label>
          <label class="mit-field">세로 (px)<input data-mit-role="height" type="number" min="1" inputmode="numeric" disabled></label>
          <label class="mit-field mit-grid-wide">원본 대비 크기
            <span class="mit-range-row"><input data-mit-role="percent" type="range" min="1" max="200" value="100" disabled><output class="mit-value-pill" data-mit-role="percent-value">100%</output></span>
          </label>
        </div>
        <label class="mit-check"><input data-mit-role="lock" type="checkbox" checked> 가로세로 비율 유지</label>
        <div class="mit-actions"><button class="mit-primary" type="button" data-mit-role="render" disabled>미리보기 만들기</button><button class="mit-download" type="button" data-mit-role="png" disabled>PNG 다운로드</button><button class="mit-download" type="button" data-mit-role="jpeg" disabled>JPG 다운로드</button></div>
        <p class="mit-status" data-mit-role="status" aria-live="polite"></p>
      </div>
      <div class="mit-preview-wrap" data-mit-role="preview"><div class="mit-empty-preview">결과 미리보기가 여기에 표시됩니다.</div></div>
    </section>
  `;

  const input = role(container, 'file-input');
  const widthInput = role(container, 'width');
  const heightInput = role(container, 'height');
  const percent = role(container, 'percent');
  const percentValue = role(container, 'percent-value');
  const lock = role(container, 'lock');
  const renderButton = role(container, 'render');
  const pngButton = role(container, 'png');
  const jpegButton = role(container, 'jpeg');
  const fileStatus = role(container, 'file-status');
  const status = role(container, 'status');
  const preview = role(container, 'preview');
  const state = { file: null, image: null, canvas: null, sourceWidth: 0, sourceHeight: 0 };

  const setPercent = value => {
    const normalized = clamp(Math.round(Number(value) || 100), 1, 200);
    percent.value = String(normalized);
    percentValue.value = `${normalized}%`;
    percentValue.textContent = `${normalized}%`;
  };
  const updateFromWidth = () => {
    if (!state.image || !lock.checked) return;
    const width = positiveInteger(widthInput.value);
    if (width) heightInput.value = String(Math.max(1, Math.round(width * state.sourceHeight / state.sourceWidth)));
  };
  const updateFromHeight = () => {
    if (!state.image || !lock.checked) return;
    const height = positiveInteger(heightInput.value);
    if (height) widthInput.value = String(Math.max(1, Math.round(height * state.sourceWidth / state.sourceHeight)));
  };
  const detachDrop = attachDropZone(container, input, async files => {
    const file = files.find(isImageFile);
    if (!file) {
      setStatus(fileStatus, '지원되는 이미지 파일을 선택해 주세요.', 'error');
      return;
    }
    setStatus(fileStatus, '이미지를 불러오는 중…');
    try {
      state.image?.release();
      state.image = await loadImage(file);
      state.file = file;
      state.sourceWidth = state.image.width;
      state.sourceHeight = state.image.height;
      state.canvas = null;
      widthInput.value = String(state.sourceWidth);
      heightInput.value = String(state.sourceHeight);
      setPercent(100);
      setDisabled([widthInput, heightInput, percent, renderButton], false);
      pngButton.disabled = true;
      jpegButton.disabled = true;
      clearPreview(preview, '결과 미리보기가 여기에 표시됩니다.');
      setStatus(fileStatus, `${file.name} · ${state.sourceWidth} × ${state.sourceHeight}px`, 'success');
      setStatus(status, '원하는 크기를 입력한 뒤 미리보기를 만드세요.');
    } catch (error) {
      setStatus(fileStatus, readableError(error), 'error');
    }
  });

  widthInput.addEventListener('input', updateFromWidth);
  heightInput.addEventListener('input', updateFromHeight);
  percent.addEventListener('input', () => {
    setPercent(percent.value);
    if (!state.image) return;
    const scale = Number(percent.value) / 100;
    widthInput.value = String(Math.max(1, Math.round(state.sourceWidth * scale)));
    heightInput.value = String(Math.max(1, Math.round(state.sourceHeight * scale)));
  });
  renderButton.addEventListener('click', () => {
    if (!state.image) return;
    try {
      const width = positiveInteger(widthInput.value);
      const height = positiveInteger(heightInput.value);
      if (!width || !height) throw new Error('가로와 세로는 1 이상의 정수로 입력해 주세요.');
      assertCanvasSize(width, height);
      const canvas = resizeWithSteps(state.image.image, state.sourceWidth, state.sourceHeight, width, height);
      state.canvas = canvas;
      showCanvas(preview, canvas);
      pngButton.disabled = false;
      jpegButton.disabled = false;
      setStatus(status, `${width} × ${height}px 미리보기를 만들었습니다.`, 'success');
    } catch (error) {
      setStatus(status, readableError(error), 'error');
    }
  });
  pngButton.addEventListener('click', async () => {
    if (!state.canvas || !state.file) return;
    downloadBlob(await canvasToBlob(state.canvas, 'image/png'), `${fileBaseName(state.file.name)}_${state.canvas.width}x${state.canvas.height}.png`);
  });
  jpegButton.addEventListener('click', async () => {
    if (!state.canvas || !state.file) return;
    downloadBlob(await canvasToBlob(flattenCanvas(state.canvas, '#ffffff'), 'image/jpeg', .92), `${fileBaseName(state.file.name)}_${state.canvas.width}x${state.canvas.height}.jpg`);
  });

  return () => {
    detachDrop();
    state.image?.release();
  };
}

function initBlurTool(container) {
  container.innerHTML = `
    <section class="mit-tool" aria-labelledby="mit-blur-title">
      <div class="mit-heading">
        <span class="mit-eyebrow">SOFTEN IMAGE</span>
        <h2 class="mit-title" id="mit-blur-title">이미지 블러</h2>
        <p class="mit-description">슬라이더로 흐림 강도를 조절하고, 언제든 원본 상태로 되돌릴 수 있습니다.</p>
      </div>
      <div class="mit-card mit-stack">
        <button class="mit-drop-zone" type="button" data-mit-role="drop-zone">
          <span class="mit-drop-copy"><span class="mit-drop-icon">◌</span><span class="mit-drop-title">흐리게 할 이미지를 선택하세요</span><span class="mit-drop-subtitle">원본은 브라우저 안에만 유지됩니다</span></span>
        </button>
        <input class="mit-file-input" data-mit-role="file-input" type="file" accept="image/*,.ico,.cur" aria-label="흐리게 할 이미지 선택">
        <p class="mit-status" data-mit-role="file-status" aria-live="polite">이미지를 선택해 주세요.</p>
        <label class="mit-field">흐림 반경
          <span class="mit-range-row"><input data-mit-role="radius" type="range" min="0" max="50" step="1" value="0" disabled><output class="mit-value-pill" data-mit-role="radius-value">0 px</output></span>
        </label>
        <div class="mit-actions"><button class="mit-secondary" type="button" data-mit-role="restore" disabled>원본 복원</button><button class="mit-download" type="button" data-mit-role="png" disabled>PNG 다운로드</button><button class="mit-download" type="button" data-mit-role="jpeg" disabled>JPG 다운로드</button></div>
        <p class="mit-status" data-mit-role="status" aria-live="polite"></p>
      </div>
      <div class="mit-preview-wrap" data-mit-role="preview"><div class="mit-empty-preview">결과 미리보기가 여기에 표시됩니다.</div></div>
    </section>
  `;

  const input = role(container, 'file-input');
  const radius = role(container, 'radius');
  const radiusValue = role(container, 'radius-value');
  const restoreButton = role(container, 'restore');
  const pngButton = role(container, 'png');
  const jpegButton = role(container, 'jpeg');
  const fileStatus = role(container, 'file-status');
  const status = role(container, 'status');
  const preview = role(container, 'preview');
  const state = { file: null, original: null, canvas: null, drawing: 0 };

  const setRadius = value => {
    const normalized = clamp(Math.round(Number(value) || 0), 0, 50);
    radius.value = String(normalized);
    radiusValue.value = `${normalized} px`;
    radiusValue.textContent = `${normalized} px`;
  };
  const draw = () => {
    state.drawing = 0;
    if (!state.original) return;
    try {
      const canvas = makeCanvas(state.original.width, state.original.height);
      const context = canvas.getContext('2d');
      const amount = Number(radius.value);
      if (amount > 0) context.filter = `blur(${amount}px)`;
      context.drawImage(state.original, 0, 0);
      context.filter = 'none';
      state.canvas = canvas;
      showCanvas(preview, canvas);
      setStatus(status, amount > 0 ? `${amount}px 블러를 적용했습니다.` : '원본 상태입니다.', 'success');
    } catch (error) {
      setStatus(status, readableError(error), 'error');
    }
  };
  const queueDraw = () => {
    if (!state.original || state.drawing) return;
    state.drawing = requestAnimationFrame(draw);
  };
  const detachDrop = attachDropZone(container, input, async files => {
    const file = files.find(isImageFile);
    if (!file) {
      setStatus(fileStatus, '지원되는 이미지 파일을 선택해 주세요.', 'error');
      return;
    }
    setStatus(fileStatus, '이미지를 불러오는 중…');
    try {
      const loaded = await loadImage(file);
      try {
        assertCanvasSize(loaded.width, loaded.height);
        const original = makeCanvas(loaded.width, loaded.height);
        original.getContext('2d').drawImage(loaded.image, 0, 0);
        state.file = file;
        state.original = original;
        state.canvas = null;
        setRadius(0);
        setDisabled([radius, restoreButton], false);
        pngButton.disabled = false;
        jpegButton.disabled = false;
        setStatus(fileStatus, `${file.name} · ${loaded.width} × ${loaded.height}px`, 'success');
        draw();
      } finally {
        loaded.release();
      }
    } catch (error) {
      setStatus(fileStatus, readableError(error), 'error');
    }
  });

  radius.addEventListener('input', () => { setRadius(radius.value); queueDraw(); });
  restoreButton.addEventListener('click', () => { setRadius(0); queueDraw(); });
  pngButton.addEventListener('click', async () => {
    if (!state.canvas || !state.file) return;
    downloadBlob(await canvasToBlob(state.canvas, 'image/png'), `${fileBaseName(state.file.name)}_blurred.png`);
  });
  jpegButton.addEventListener('click', async () => {
    if (!state.canvas || !state.file) return;
    downloadBlob(await canvasToBlob(flattenCanvas(state.canvas, '#ffffff'), 'image/jpeg', .92), `${fileBaseName(state.file.name)}_blurred.jpg`);
  });

  return () => {
    detachDrop();
    if (state.drawing) cancelAnimationFrame(state.drawing);
  };
}

function role(root, name) {
  return root.querySelector(`[data-mit-role="${name}"]`);
}

function attachDropZone(root, input, onFiles) {
  const zone = role(root, 'drop-zone');
  const useFiles = files => onFiles(Array.from(files || []));
  const onClick = () => input.click();
  const onChange = () => {
    useFiles(input.files);
    input.value = '';
  };
  const onDragOver = event => {
    event.preventDefault();
    zone.classList.add('mit-drop-active');
  };
  const onDragLeave = () => zone.classList.remove('mit-drop-active');
  const onDrop = event => {
    event.preventDefault();
    zone.classList.remove('mit-drop-active');
    useFiles(event.dataTransfer?.files);
  };
  zone.addEventListener('click', onClick);
  zone.addEventListener('dragover', onDragOver);
  zone.addEventListener('dragleave', onDragLeave);
  zone.addEventListener('drop', onDrop);
  input.addEventListener('change', onChange);
  return () => {
    zone.removeEventListener('click', onClick);
    zone.removeEventListener('dragover', onDragOver);
    zone.removeEventListener('dragleave', onDragLeave);
    zone.removeEventListener('drop', onDrop);
    input.removeEventListener('change', onChange);
  };
}

function isImageFile(file) {
  if (!file) return false;
  if (typeof file.type === 'string' && file.type.startsWith('image/')) return true;
  return /\.(?:avif|bmp|cur|gif|ico|jpe?g|png|svg|webp)$/i.test(file.name || '');
}

function setStatus(element, message, tone = '') {
  element.textContent = message;
  element.classList.toggle('mit-status-error', tone === 'error');
  element.classList.toggle('mit-status-success', tone === 'success');
}

function setDisabled(elements, disabled) {
  elements.forEach(element => { element.disabled = disabled; });
}

function makeCanvas(width, height) {
  assertCanvasSize(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('이 브라우저에서 Canvas를 시작할 수 없습니다.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return canvas;
}

function assertCanvasSize(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('올바른 이미지 크기를 만들 수 없습니다.');
  }
  if (width > MIT_MAX_DIMENSION || height > MIT_MAX_DIMENSION || width * height > MIT_MAX_PIXELS) {
    throw new Error(`이미지가 너무 큽니다. 한 변 ${MIT_MAX_DIMENSION.toLocaleString()}px, 총 ${Math.round(MIT_MAX_PIXELS / 1_000_000)}MP 이하의 이미지를 사용해 주세요.`);
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      URL.revokeObjectURL(url);
    };
    image.decoding = 'async';
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) {
        release();
        reject(new Error('이미지 크기를 읽을 수 없습니다.'));
        return;
      }
      resolve({ image, width, height, release });
    };
    image.onerror = () => {
      release();
      reject(new Error('이 브라우저에서 이미지를 열 수 없습니다.'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      try {
        resolve(dataUrlToBlob(canvas.toDataURL(type, quality)));
      } catch (error) {
        reject(error);
      }
      return;
    }
    canvas.toBlob(blob => {
      if (!blob) reject(new Error('이미지 파일을 만들지 못했습니다.'));
      else resolve(blob);
    }, type, quality);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, payload] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(header)?.[1] || 'application/octet-stream';
  const bytes = atob(payload);
  const output = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) output[index] = bytes.charCodeAt(index);
  return new Blob([output], { type: mime });
}

async function encodeCanvas(canvas, format, options = {}) {
  const meta = FORMAT_META[format];
  if (!meta) throw new Error('지원하지 않는 출력 형식입니다.');
  if (format === 'bmp') return encodeBmp(canvas);
  if (format === 'ico' || format === 'cur') {
    const iconCanvas = makeIconCanvas(canvas, options.iconSize || 256);
    const png = await canvasToBlob(iconCanvas, 'image/png');
    return encodeIcon(png, iconCanvas.width, iconCanvas.height, format === 'cur');
  }
  const target = format === 'jpeg' ? flattenCanvas(canvas, options.background || '#ffffff') : canvas;
  const blob = await canvasToBlob(target, meta.mime, options.quality);
  if (format === 'webp' && blob.type !== 'image/webp') {
    throw new Error('이 브라우저는 WebP 인코딩을 지원하지 않습니다.');
  }
  return blob;
}

function flattenCanvas(canvas, background) {
  const output = makeCanvas(canvas.width, canvas.height);
  const context = output.getContext('2d');
  context.fillStyle = background || '#ffffff';
  context.fillRect(0, 0, output.width, output.height);
  context.drawImage(canvas, 0, 0);
  return output;
}

function encodeBmp(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  const rowSize = width * 4;
  const headerSize = 54;
  const buffer = new ArrayBuffer(headerSize + rowSize * height);
  const view = new DataView(buffer);
  view.setUint8(0, 0x42);
  view.setUint8(1, 0x4d);
  view.setUint32(2, buffer.byteLength, true);
  view.setUint32(10, headerSize, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 32, true);
  view.setUint32(30, 0, true);
  view.setUint32(34, rowSize * height, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);
  const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const output = new Uint8Array(buffer);
  for (let y = 0; y < height; y += 1) {
    const sourceRow = y * width * 4;
    const targetRow = headerSize + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x += 1) {
      const source = sourceRow + x * 4;
      const target = targetRow + x * 4;
      output[target] = pixels[source + 2];
      output[target + 1] = pixels[source + 1];
      output[target + 2] = pixels[source];
      output[target + 3] = pixels[source + 3];
    }
  }
  return new Blob([buffer], { type: 'image/bmp' });
}

function makeIconCanvas(source, size) {
  const iconSize = clamp(Math.round(Number(size) || 256), 1, 256);
  const output = makeCanvas(iconSize, iconSize);
  const scale = Math.min(iconSize / source.width, iconSize / source.height);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  output.getContext('2d').drawImage(source, (iconSize - width) / 2, (iconSize - height) / 2, width, height);
  return output;
}

function encodeIcon(pngBlob, width, height, cursor) {
  const pngSize = pngBlob.size;
  const header = new ArrayBuffer(22);
  const view = new DataView(header);
  view.setUint16(0, 0, true);
  view.setUint16(2, cursor ? 2 : 1, true);
  view.setUint16(4, 1, true);
  view.setUint8(6, width === 256 ? 0 : width);
  view.setUint8(7, height === 256 ? 0 : height);
  view.setUint8(8, 0);
  view.setUint8(9, 0);
  if (cursor) {
    view.setUint16(10, Math.floor(width / 2), true);
    view.setUint16(12, Math.floor(height / 2), true);
  } else {
    view.setUint16(10, 1, true);
    view.setUint16(12, 32, true);
  }
  view.setUint32(14, pngSize, true);
  view.setUint32(18, 22, true);
  return new Blob([header, pngBlob], { type: cursor ? 'image/x-win-bitmap' : 'image/x-icon' });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function makeConversionResult({ previewUrl, filename, blob, source, format }) {
  const card = document.createElement('article');
  card.className = 'mit-result-card';
  const preview = document.createElement('img');
  preview.className = 'mit-result-preview';
  preview.src = previewUrl;
  preview.alt = `${filename} 미리보기`;
  const copy = document.createElement('div');
  copy.className = 'mit-result-copy';
  const name = document.createElement('div');
  name.className = 'mit-result-name';
  name.textContent = filename;
  const meta = document.createElement('div');
  meta.className = 'mit-result-meta';
  meta.textContent = `${format.label} · ${formatBytes(source.size)} → ${formatBytes(blob.size)}`;
  copy.append(name, meta);
  const download = document.createElement('button');
  download.className = 'mit-download';
  download.type = 'button';
  download.textContent = '다운로드';
  download.addEventListener('click', () => downloadBlob(blob, filename));
  card.append(preview, copy, download);
  return card;
}

function makeErrorResult(filename, message) {
  const card = document.createElement('article');
  card.className = 'mit-result-card';
  const copy = document.createElement('div');
  copy.className = 'mit-result-copy';
  const name = document.createElement('div');
  name.className = 'mit-result-name';
  name.textContent = filename;
  const detail = document.createElement('div');
  detail.className = 'mit-result-meta';
  detail.textContent = message;
  copy.append(name, detail);
  card.append(copy);
  return card;
}

function collectDominantColors(imageData) {
  const bins = new Map();
  let pixels = 0;
  const data = imageData.data;
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3];
    if (alpha < 24) continue;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const key = `${red >> 4}-${green >> 4}-${blue >> 4}`;
    const bin = bins.get(key) || { count: 0, red: 0, green: 0, blue: 0 };
    bin.count += 1;
    bin.red += red;
    bin.green += green;
    bin.blue += blue;
    bins.set(key, bin);
    pixels += 1;
  }
  const rows = [...bins.values()].map(bin => ({
    count: bin.count,
    hex: rgbToHex(Math.round(bin.red / bin.count), Math.round(bin.green / bin.count), Math.round(bin.blue / bin.count)),
    percent: bin.count * 100 / Math.max(1, pixels),
  })).sort((left, right) => right.count - left.count);
  return { rows, pixels, bins: bins.size };
}

function makePaletteCanvas(rows) {
  const width = 960;
  const height = 132;
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext('2d');
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  let cursor = 0;
  rows.forEach((row, index) => {
    const remaining = width - cursor;
    const segment = index === rows.length - 1 ? remaining : Math.max(1, Math.round(width * row.count / total));
    context.fillStyle = row.hex;
    context.fillRect(cursor, 0, segment, height);
    if (segment >= 70) {
      context.fillStyle = readableTextColor(row.hex);
      context.font = '700 14px system-ui, sans-serif';
      context.textAlign = 'center';
      context.fillText(row.hex, cursor + segment / 2, 55);
      context.font = '600 12px system-ui, sans-serif';
      context.fillText(`${row.percent.toFixed(1)}%`, cursor + segment / 2, 78);
    }
    cursor += segment;
  });
  return canvas;
}

function renderColorResults(list, rows) {
  list.replaceChildren();
  rows.forEach((row, index) => {
    const item = document.createElement('div');
    item.className = 'mit-color-row';
    const swatch = document.createElement('span');
    swatch.className = 'mit-swatch';
    swatch.style.backgroundColor = row.hex;
    swatch.title = row.hex;
    const copy = document.createElement('div');
    const hex = document.createElement('div');
    hex.className = 'mit-hex';
    hex.textContent = `${index + 1}. ${row.hex}`;
    const note = document.createElement('div');
    note.className = 'mit-result-meta';
    note.textContent = `${row.count.toLocaleString()} 픽셀`;
    copy.append(hex, note);
    const percentage = document.createElement('div');
    percentage.className = 'mit-color-meta';
    percentage.textContent = `${row.percent.toFixed(2)}%`;
    item.append(swatch, copy, percentage);
    list.append(item);
  });
}

function copyCanvas(source, target) {
  target.width = source.width;
  target.height = source.height;
  const context = target.getContext('2d');
  context.drawImage(source, 0, 0);
}

function makeMergeLayout(images, direction, fit) {
  const horizontal = direction === 'horizontal';
  const crossValues = images.map(image => horizontal ? image.height : image.width);
  const targetCross = fit === 'none'
    ? null
    : fit === 'min' ? Math.min(...crossValues) : Math.max(...crossValues);
  const placements = [];
  let cursor = 0;
  let cross = targetCross || Math.max(...crossValues);
  images.forEach(image => {
    const scale = targetCross ? targetCross / (horizontal ? image.height : image.width) : 1;
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const placement = horizontal
      ? { image, x: cursor, y: Math.round((cross - height) / 2), width, height }
      : { image, x: Math.round((cross - width) / 2), y: cursor, width, height };
    placements.push(placement);
    cursor += horizontal ? width : height;
  });
  return horizontal
    ? { width: cursor, height: cross, placements }
    : { width: cross, height: cursor, placements };
}

function resizeWithSteps(image, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  let source = image;
  let width = sourceWidth;
  let height = sourceHeight;
  while (width / 2 > targetWidth && height / 2 > targetHeight) {
    const nextWidth = Math.max(targetWidth, Math.floor(width / 2));
    const nextHeight = Math.max(targetHeight, Math.floor(height / 2));
    const next = makeCanvas(nextWidth, nextHeight);
    next.getContext('2d').drawImage(source, 0, 0, nextWidth, nextHeight);
    source = next;
    width = nextWidth;
    height = nextHeight;
  }
  const output = makeCanvas(targetWidth, targetHeight);
  output.getContext('2d').drawImage(source, 0, 0, targetWidth, targetHeight);
  return output;
}

function showCanvas(holder, canvas) {
  canvas.className = 'mit-canvas';
  holder.replaceChildren(canvas);
}

function clearPreview(holder, message) {
  const empty = document.createElement('div');
  empty.className = 'mit-empty-preview';
  empty.textContent = message;
  holder.replaceChildren(empty);
}

function fileBaseName(name) {
  const base = String(name || 'image').replace(/\.[^.\\/]+$/, '').trim() || 'image';
  return base.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function readableError(error) {
  return error instanceof Error && error.message ? error.message : '처리 중 알 수 없는 문제가 발생했습니다.';
}

function positiveInteger(value) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue].map(value => clamp(value, 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function readableTextColor(hex) {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance > 156 ? '#392417' : '#ffffff';
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}
