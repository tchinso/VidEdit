/**
 * 이미지 픽셀 변환 및 포렌식 도구
 *
 * 파일은 모두 Canvas API로 브라우저 안에서만 처리한다. OpenCV나 서버 의존성은 없다.
 */

const PIXEL_MAX_SIDE = 1600;
const ANALYSIS_MAX_SIDE = 1280;
const PALETTE_SAMPLE_LIMIT = 50000;

let stylesInstalled = false;

/**
 * #pixelTool, #forensicsTool 컨테이너에 독립적인 이미지 도구를 붙인다.
 * 여러 번 호출해도 같은 컨테이너는 한 번만 초기화한다.
 */
export function initImageAnalysisTools() {
  const pixelRoot = document.getElementById('pixelTool');
  const forensicsRoot = document.getElementById('forensicsTool');

  if (!pixelRoot && !forensicsRoot) return null;
  installStyles();

  const tools = {};
  if (pixelRoot && !pixelRoot.dataset.miaInitialized) {
    pixelRoot.dataset.miaInitialized = 'true';
    tools.pixel = initPixelTool(pixelRoot);
  }
  if (forensicsRoot && !forensicsRoot.dataset.miaInitialized) {
    forensicsRoot.dataset.miaInitialized = 'true';
    tools.forensics = initForensicsTool(forensicsRoot);
  }

  return tools;
}

function installStyles() {
  if (stylesInstalled || document.getElementById('mia-tool-styles')) {
    stylesInstalled = true;
    return;
  }

  const style = document.createElement('style');
  style.id = 'mia-tool-styles';
  style.textContent = `
    .mia-tool {
      --mia-orange: #ee7722;
      --mia-orange-dark: #c95714;
      --mia-orange-soft: #fff0e5;
      --mia-cream: #fffaf5;
      --mia-line: #f2d3bd;
      --mia-ink: #44332a;
      --mia-muted: #826b5d;
      --mia-good: #238052;
      width: 100%;
      color: var(--mia-ink);
      font-family: "Pretendard", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif;
    }

    .mia-tool *, .mia-tool *::before, .mia-tool *::after { box-sizing: border-box; }
    .mia-tool button, .mia-tool input, .mia-tool select { font: inherit; }
    .mia-tool [hidden] { display: none !important; }

    .mia-panel {
      overflow: hidden;
      padding: clamp(18px, 3vw, 26px);
      border: 1px solid var(--mia-line);
      border-radius: 24px;
      background: linear-gradient(145deg, #ffffff, var(--mia-cream));
      box-shadow: 0 14px 36px rgba(139, 74, 27, .08);
    }

    .mia-heading { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 18px; }
    .mia-heading-icon {
      display: grid;
      width: 42px;
      height: 42px;
      flex: 0 0 auto;
      place-items: center;
      border-radius: 14px;
      background: var(--mia-orange-soft);
      color: var(--mia-orange-dark);
      font-size: 1.35rem;
    }
    .mia-heading h2 { margin: 0; color: var(--mia-ink); font-size: 1.16rem; letter-spacing: -.025em; }
    .mia-heading p { margin: 4px 0 0; color: var(--mia-muted); font-size: .84rem; line-height: 1.55; }

    .mia-upload {
      display: flex;
      min-height: 154px;
      align-items: center;
      justify-content: center;
      padding: 22px;
      border: 2px dashed #edaa7d;
      border-radius: 19px;
      background: #fffaf6;
      cursor: pointer;
      text-align: center;
      transition: border-color .18s ease, background .18s ease, transform .18s ease;
    }
    .mia-upload:hover, .mia-upload.mia-dragover {
      border-color: var(--mia-orange);
      background: var(--mia-orange-soft);
      transform: translateY(-1px);
    }
    .mia-upload:focus-visible, .mia-tool button:focus-visible, .mia-tool input:focus-visible, .mia-tool select:focus-visible {
      outline: 3px solid rgba(238, 119, 34, .28);
      outline-offset: 3px;
    }
    .mia-upload-icon { margin-bottom: 7px; font-size: 2rem; }
    .mia-upload-title { color: var(--mia-ink); font-size: .98rem; font-weight: 800; }
    .mia-upload-copy { margin-top: 6px; color: var(--mia-muted); font-size: .79rem; line-height: 1.5; }
    .mia-file-input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; clip-path: inset(50%); }

    .mia-file-info, .mia-status {
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: 13px;
      background: #fff7f1;
      color: var(--mia-muted);
      font-size: .81rem;
      line-height: 1.55;
      overflow-wrap: anywhere;
    }
    .mia-status { border: 1px solid transparent; }
    .mia-status[data-tone="working"] { color: #8a4c18; border-color: #f4c69e; background: #fff2e4; }
    .mia-status[data-tone="success"] { color: var(--mia-good); border-color: #bde1ce; background: #effbf4; }
    .mia-status[data-tone="error"] { color: #a63c31; border-color: #f0c7c1; background: #fff2f0; }

    .mia-controls {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
      gap: 12px;
      margin-top: 16px;
      padding: 15px;
      border: 1px solid #f3ddcc;
      border-radius: 18px;
      background: rgba(255, 255, 255, .72);
    }
    .mia-field { display: flex; flex-direction: column; gap: 7px; min-width: 0; color: #6e5749; font-size: .8rem; font-weight: 750; }
    .mia-field label { display: flex; justify-content: space-between; gap: 8px; }
    .mia-field output { color: var(--mia-orange-dark); font-variant-numeric: tabular-nums; }
    .mia-tool select, .mia-tool input[type="number"] {
      width: 100%;
      min-width: 0;
      padding: 9px 10px;
      border: 1px solid #e9cdb8;
      border-radius: 11px;
      background: #fff;
      color: var(--mia-ink);
    }
    .mia-tool input[type="range"] { width: 100%; accent-color: var(--mia-orange); }
    .mia-check-field { justify-content: end; }
    .mia-check {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 38px;
      padding: 8px 10px;
      border: 1px solid #ecd4c1;
      border-radius: 11px;
      color: #6e5749;
      font-size: .8rem;
      font-weight: 700;
      cursor: pointer;
    }
    .mia-check input { width: 16px; height: 16px; accent-color: var(--mia-orange); }

    .mia-primary-button, .mia-download-button, .mia-compact-button {
      border: 0;
      border-radius: 13px;
      cursor: pointer;
      font-weight: 800;
      transition: transform .18s ease, filter .18s ease, background .18s ease;
    }
    .mia-primary-button { width: 100%; margin-top: 15px; padding: 12px 16px; background: linear-gradient(135deg, var(--mia-orange), #f58b38); color: #fff; }
    .mia-primary-button:hover, .mia-download-button:hover, .mia-compact-button:hover { filter: brightness(1.04); transform: translateY(-1px); }
    .mia-primary-button:disabled, .mia-download-button:disabled, .mia-compact-button:disabled { cursor: wait; opacity: .56; transform: none; }
    .mia-download-button { padding: 9px 11px; background: #fff0e5; color: var(--mia-orange-dark); font-size: .77rem; }
    .mia-compact-button { padding: 9px 12px; background: #fff0e5; color: var(--mia-orange-dark); font-size: .78rem; }

    .mia-preview-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 16px; }
    .mia-preview-card { min-width: 0; margin: 0; overflow: hidden; border: 1px solid #f1dccb; border-radius: 17px; background: #fff; }
    .mia-preview-card figcaption { padding: 10px 12px; color: #6e5749; font-size: .79rem; font-weight: 800; }
    .mia-preview-image, .mia-preview-canvas {
      display: block;
      width: 100%;
      min-height: 158px;
      max-height: 350px;
      background:
        linear-gradient(45deg, #f2e9e2 25%, transparent 25%) 0 0 / 16px 16px,
        linear-gradient(-45deg, #f2e9e2 25%, transparent 25%) 0 8px / 16px 16px,
        linear-gradient(45deg, transparent 75%, #f2e9e2 75%) 8px -8px / 16px 16px,
        linear-gradient(-45deg, transparent 75%, #f2e9e2 75%) -8px 0 / 16px 16px,
        #fff;
      object-fit: contain;
    }
    .mia-preview-canvas { image-rendering: pixelated; }
    .mia-preview-card .mia-download-button { width: calc(100% - 24px); margin: 0 12px 12px; }

    .mia-palette { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    .mia-palette-empty { color: var(--mia-muted); font-size: .8rem; }
    .mia-palette-chip { display: inline-flex; align-items: center; gap: 7px; padding: 6px 8px; border: 1px solid #efdbca; border-radius: 999px; background: #fff; color: #665044; font-size: .74rem; font-weight: 700; }
    .mia-palette-swatch { width: 17px; height: 17px; border: 1px solid rgba(50, 35, 25, .18); border-radius: 50%; }

    .mia-analysis-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-top: 16px; }
    .mia-analysis-toolbar .mia-field { flex: 1 1 210px; }
    .mia-analysis-toolbar .mia-compact-button { align-self: end; }
    .mia-scan-note { margin: 14px 0 0; color: var(--mia-muted); font-size: .78rem; line-height: 1.55; }
    .mia-scan-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
    .mia-scan-card { min-width: 0; overflow: hidden; border: 1px solid #f0dbca; border-radius: 17px; background: #fff; }
    .mia-scan-card-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 10px 8px; }
    .mia-scan-card h3 { min-width: 0; margin: 0; color: #5d4538; font-size: .78rem; letter-spacing: -.015em; }
    .mia-scan-canvas {
      display: block;
      width: 100%;
      min-height: 112px;
      max-height: 245px;
      background:
        linear-gradient(45deg, #f2e9e2 25%, transparent 25%) 0 0 / 16px 16px,
        linear-gradient(-45deg, #f2e9e2 25%, transparent 25%) 0 8px / 16px 16px,
        linear-gradient(45deg, transparent 75%, #f2e9e2 75%) 8px -8px / 16px 16px,
        linear-gradient(-45deg, transparent 75%, #f2e9e2 75%) -8px 0 / 16px 16px,
        #fff;
        object-fit: contain;
    }

    @media (max-width: 620px) {
      .mia-preview-grid { grid-template-columns: 1fr; }
      .mia-scan-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .mia-panel { padding: 17px; border-radius: 20px; }
    }
    @media (max-width: 390px) {
      .mia-scan-grid { grid-template-columns: 1fr; }
    }
  `;
  document.head.append(style);
  stylesInstalled = true;
}

function initPixelTool(root) {
  root.classList.add('mia-tool');
  root.innerHTML = `
    <section class="mia-panel" aria-labelledby="mia-pixel-title">
      <div class="mia-heading">
        <span class="mia-heading-icon" aria-hidden="true">▦</span>
        <div>
          <h2 id="mia-pixel-title">픽셀 · 도트 변환</h2>
          <p>색상을 간추리고 픽셀 크기를 키워 PNG 도트 이미지로 만듭니다.</p>
        </div>
      </div>
      <div class="mia-upload" data-mia-pixel-drop tabindex="0" role="button" aria-label="픽셀 변환할 이미지 선택">
        <div>
          <div class="mia-upload-icon" aria-hidden="true">🟧</div>
          <div class="mia-upload-title">이미지를 놓거나 클릭해서 선택하세요</div>
          <div class="mia-upload-copy">PNG, JPEG, WebP, GIF 등 · 브라우저 안에서만 처리됩니다</div>
        </div>
      </div>
      <input class="mia-file-input" data-mia-pixel-input type="file" accept="image/*">
      <div class="mia-file-info" data-mia-pixel-file-info>아직 선택된 이미지가 없습니다.</div>

      <div class="mia-controls" aria-label="픽셀 변환 옵션">
        <div class="mia-field">
          <label for="mia-pixel-palette">팔레트 색상 수</label>
          <select id="mia-pixel-palette" data-mia-pixel-palette>
            <option value="2">2색</option>
            <option value="4" selected>4색</option>
            <option value="8">8색</option>
            <option value="16">16색</option>
          </select>
        </div>
        <div class="mia-field">
          <label for="mia-pixel-scale">픽셀 크기 <output data-mia-pixel-scale-value>6px</output></label>
          <input id="mia-pixel-scale" data-mia-pixel-scale type="range" min="2" max="24" step="1" value="6">
        </div>
        <div class="mia-field">
          <label for="mia-pixel-edge">경계 처리</label>
          <select id="mia-pixel-edge" data-mia-pixel-edge>
            <option value="none" selected>기본</option>
            <option value="outline">윤곽 강조</option>
            <option value="soft">부드럽게</option>
          </select>
        </div>
        <div class="mia-field">
          <label for="mia-pixel-alpha">투명 영역</label>
          <select id="mia-pixel-alpha" data-mia-pixel-alpha>
            <option value="preserve" selected>원본 투명도 유지</option>
            <option value="threshold">투명/불투명으로 정리</option>
            <option value="white">흰 배경으로 합성</option>
          </select>
        </div>
        <div class="mia-field mia-check-field">
          <label class="mia-check"><input data-mia-pixel-smoothing type="checkbox" checked> 색상 부드럽게 샘플링</label>
        </div>
      </div>
      <button class="mia-primary-button" data-mia-pixel-convert type="button">도트 이미지 만들기</button>
      <div class="mia-status" data-mia-pixel-status aria-live="polite">이미지를 선택하면 변환 옵션을 적용할 수 있습니다.</div>

      <div class="mia-preview-grid">
        <figure class="mia-preview-card">
          <figcaption>원본</figcaption>
          <img class="mia-preview-image" data-mia-pixel-original alt="선택한 원본 이미지">
        </figure>
        <figure class="mia-preview-card" data-mia-pixel-result-card hidden>
          <figcaption>도트 결과</figcaption>
          <canvas class="mia-preview-canvas" data-mia-pixel-result aria-label="도트 변환 결과"></canvas>
          <button class="mia-download-button" data-mia-pixel-download type="button">PNG 저장</button>
        </figure>
      </div>
      <div class="mia-palette" data-mia-pixel-palette-display><span class="mia-palette-empty">변환 후 사용한 색상이 여기에 표시됩니다.</span></div>
    </section>
  `;

  const el = {
    drop: root.querySelector('[data-mia-pixel-drop]'),
    input: root.querySelector('[data-mia-pixel-input]'),
    fileInfo: root.querySelector('[data-mia-pixel-file-info]'),
    paletteCount: root.querySelector('[data-mia-pixel-palette]'),
    scale: root.querySelector('[data-mia-pixel-scale]'),
    scaleValue: root.querySelector('[data-mia-pixel-scale-value]'),
    edge: root.querySelector('[data-mia-pixel-edge]'),
    alpha: root.querySelector('[data-mia-pixel-alpha]'),
    smoothing: root.querySelector('[data-mia-pixel-smoothing]'),
    convert: root.querySelector('[data-mia-pixel-convert]'),
    status: root.querySelector('[data-mia-pixel-status]'),
    original: root.querySelector('[data-mia-pixel-original]'),
    resultCard: root.querySelector('[data-mia-pixel-result-card]'),
    result: root.querySelector('[data-mia-pixel-result]'),
    download: root.querySelector('[data-mia-pixel-download]'),
    palette: root.querySelector('[data-mia-pixel-palette-display]'),
  };

  const state = {
    file: null,
    sourceCanvas: null,
    previewUrl: null,
    busy: false,
  };

  const setStatus = (message, tone = 'info') => {
    el.status.textContent = message;
    el.status.dataset.tone = tone === 'info' ? '' : tone;
  };

  const setBusy = busy => {
    state.busy = busy;
    el.convert.disabled = busy;
    el.download.disabled = busy;
  };

  const updateScaleLabel = () => {
    el.scaleValue.textContent = `${el.scale.value}px`;
  };

  const openPicker = () => {
    if (!state.busy) el.input.click();
  };

  el.drop.addEventListener('click', openPicker);
  el.drop.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  });
  addDropHandlers(el.drop, files => receivePixelFile(files[0]));
  el.input.addEventListener('change', event => {
    receivePixelFile(event.target.files?.[0]);
    event.target.value = '';
  });
  el.scale.addEventListener('input', updateScaleLabel);
  el.convert.addEventListener('click', () => convertPixelImage());
  el.download.addEventListener('click', async () => {
    if (!state.file || !el.result.width) return;
    try {
      await downloadCanvas(el.result, `${fileStem(state.file.name)}-pixel.png`);
    } catch (error) {
      setStatus(error.message || 'PNG를 저장하지 못했습니다.', 'error');
    }
  });
  updateScaleLabel();

  async function receivePixelFile(file) {
    if (!file) return;
    if (!isImageFile(file)) {
      setStatus('이미지 파일만 선택할 수 있습니다.', 'error');
      return;
    }

    setBusy(true);
    setStatus('이미지를 읽고 있습니다…', 'working');
    try {
      const image = await loadImageFromFile(file);
      state.file = file;
      state.sourceCanvas = drawImageToCanvas(image, PIXEL_MAX_SIDE);
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = URL.createObjectURL(file);
      el.original.src = state.previewUrl;
      el.resultCard.hidden = true;
      clearPalette(el.palette);
      const originalSize = `${image.naturalWidth || image.width}×${image.naturalHeight || image.height}`;
      const workingSize = `${state.sourceCanvas.width}×${state.sourceCanvas.height}`;
      const resizeNote = originalSize === workingSize ? '' : ` · 작업 크기 ${workingSize}`;
      el.fileInfo.textContent = `${file.name} · ${formatFileSize(file.size)} · 원본 ${originalSize}${resizeNote}`;
      setStatus('옵션을 확인한 뒤 도트 이미지 만들기를 눌러 주세요.');
    } catch (error) {
      state.file = null;
      state.sourceCanvas = null;
      setStatus(error.message || '이미지를 읽지 못했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function convertPixelImage() {
    if (state.busy) return;
    if (!state.sourceCanvas || !state.file) {
      setStatus('먼저 변환할 이미지를 선택해 주세요.', 'error');
      return;
    }

    setBusy(true);
    setStatus('색상을 분석하고 도트 이미지를 만드는 중입니다…', 'working');
    try {
      await nextFrame();
      const options = {
        paletteSize: Number(el.paletteCount.value),
        scale: Number(el.scale.value),
        edge: el.edge.value,
        alpha: el.alpha.value,
        smoothing: el.smoothing.checked,
      };
      const transformed = makePixelImage(state.sourceCanvas, options);
      el.result.width = transformed.canvas.width;
      el.result.height = transformed.canvas.height;
      const resultContext = el.result.getContext('2d');
      resultContext.clearRect(0, 0, el.result.width, el.result.height);
      resultContext.drawImage(transformed.canvas, 0, 0);
      el.resultCard.hidden = false;
      renderPalette(el.palette, transformed.palette);
      setStatus(`${transformed.gridWidth}×${transformed.gridHeight} 도트 그리드와 ${transformed.palette.length}개 색상으로 변환했습니다.`, 'success');
    } catch (error) {
      setStatus(error.message || '도트 변환 중 오류가 발생했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return {
    destroy() {
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    },
  };
}

function makePixelImage(sourceCanvas, options) {
  const gridWidth = Math.max(1, Math.ceil(sourceCanvas.width / options.scale));
  const gridHeight = Math.max(1, Math.ceil(sourceCanvas.height / options.scale));
  const reduced = document.createElement('canvas');
  reduced.width = gridWidth;
  reduced.height = gridHeight;
  const reducedContext = reduced.getContext('2d', { willReadFrequently: true });

  if (options.alpha === 'white') {
    reducedContext.fillStyle = '#ffffff';
    reducedContext.fillRect(0, 0, gridWidth, gridHeight);
  }
  reducedContext.imageSmoothingEnabled = options.smoothing;
  if (options.smoothing) reducedContext.imageSmoothingQuality = 'high';
  reducedContext.drawImage(sourceCanvas, 0, 0, gridWidth, gridHeight);

  const imageData = reducedContext.getImageData(0, 0, gridWidth, gridHeight);
  normaliseTransparency(imageData.data, options.alpha);
  const palette = kMeansPalette(imageData.data, options.paletteSize, options.alpha === 'threshold' ? 127 : 8);
  const labels = quantizeToPalette(imageData.data, palette, options.alpha === 'threshold' ? 127 : 8);

  if (options.edge === 'outline') {
    darkenPixelBoundaries(imageData.data, labels, gridWidth, gridHeight);
  }

  reducedContext.putImageData(imageData, 0, 0);
  const output = document.createElement('canvas');
  output.width = sourceCanvas.width;
  output.height = sourceCanvas.height;
  const outputContext = output.getContext('2d');
  outputContext.imageSmoothingEnabled = options.edge === 'soft';
  if (options.edge === 'soft') outputContext.imageSmoothingQuality = 'high';
  outputContext.drawImage(reduced, 0, 0, output.width, output.height);

  return { canvas: output, palette, gridWidth, gridHeight };
}

function normaliseTransparency(data, strategy) {
  if (strategy === 'white') return;
  for (let index = 3; index < data.length; index += 4) {
    if (strategy === 'threshold') {
      data[index] = data[index] >= 128 ? 255 : 0;
    } else if (data[index] < 8) {
      data[index] = 0;
    }
  }
}

function kMeansPalette(data, requestedCount, alphaThreshold) {
  const pixelCount = data.length / 4;
  const stride = Math.max(1, Math.ceil(pixelCount / PALETTE_SAMPLE_LIMIT));
  const samples = [];
  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const offset = pixel * 4;
    if (data[offset + 3] > alphaThreshold) samples.push(offset);
  }

  if (!samples.length) return [[0, 0, 0]];
  const count = Math.min(requestedCount, samples.length);
  const centers = [];
  for (let index = 0; index < count; index += 1) {
    const offset = samples[Math.floor((index / count) * samples.length)];
    centers.push([data[offset], data[offset + 1], data[offset + 2]]);
  }

  for (let iteration = 0; iteration < 9; iteration += 1) {
    const sums = new Float64Array(count * 4);
    for (const offset of samples) {
      const nearest = findNearestColor(data[offset], data[offset + 1], data[offset + 2], centers);
      const sumOffset = nearest * 4;
      sums[sumOffset] += data[offset];
      sums[sumOffset + 1] += data[offset + 1];
      sums[sumOffset + 2] += data[offset + 2];
      sums[sumOffset + 3] += 1;
    }
    for (let index = 0; index < count; index += 1) {
      const sumOffset = index * 4;
      if (sums[sumOffset + 3]) {
        centers[index][0] = Math.round(sums[sumOffset] / sums[sumOffset + 3]);
        centers[index][1] = Math.round(sums[sumOffset + 1] / sums[sumOffset + 3]);
        centers[index][2] = Math.round(sums[sumOffset + 2] / sums[sumOffset + 3]);
      }
    }
  }

  return centers;
}

function quantizeToPalette(data, palette, alphaThreshold) {
  const labels = new Int16Array(data.length / 4);
  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    const offset = pixel * 4;
    if (data[offset + 3] <= alphaThreshold) {
      labels[pixel] = -1;
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
      continue;
    }
    const nearest = findNearestColor(data[offset], data[offset + 1], data[offset + 2], palette);
    labels[pixel] = nearest;
    data[offset] = palette[nearest][0];
    data[offset + 1] = palette[nearest][1];
    data[offset + 2] = palette[nearest][2];
  }
  return labels;
}

function findNearestColor(red, green, blue, palette) {
  let nearest = 0;
  let minDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < palette.length; index += 1) {
    const color = palette[index];
    const distance = (red - color[0]) ** 2 + (green - color[1]) ** 2 + (blue - color[2]) ** 2;
    if (distance < minDistance) {
      minDistance = distance;
      nearest = index;
    }
  }
  return nearest;
}

function darkenPixelBoundaries(data, labels, width, height) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const label = labels[pixel];
      if (label < 0) continue;
      const right = x + 1 < width ? labels[pixel + 1] : label;
      const below = y + 1 < height ? labels[pixel + width] : label;
      const left = x ? labels[pixel - 1] : label;
      const above = y ? labels[pixel - width] : label;
      if (right !== label || below !== label || left !== label || above !== label) {
        const offset = pixel * 4;
        data[offset] = Math.round(data[offset] * .72);
        data[offset + 1] = Math.round(data[offset + 1] * .72);
        data[offset + 2] = Math.round(data[offset + 2] * .72);
      }
    }
  }
}

function renderPalette(root, palette) {
  root.replaceChildren();
  for (const [red, green, blue] of palette) {
    const chip = document.createElement('span');
    chip.className = 'mia-palette-chip';
    const swatch = document.createElement('span');
    swatch.className = 'mia-palette-swatch';
    const hex = rgbToHex(red, green, blue);
    swatch.style.backgroundColor = hex;
    const code = document.createElement('span');
    code.textContent = hex.toUpperCase();
    chip.append(swatch, code);
    root.append(chip);
  }
}

function clearPalette(root) {
  const empty = document.createElement('span');
  empty.className = 'mia-palette-empty';
  empty.textContent = '변환 후 사용한 색상이 여기에 표시됩니다.';
  root.replaceChildren(empty);
}

function initForensicsTool(root) {
  root.classList.add('mia-tool');
  root.innerHTML = `
    <section class="mia-panel" aria-labelledby="mia-forensics-title">
      <div class="mia-heading">
        <span class="mia-heading-icon" aria-hidden="true">⌁</span>
        <div>
          <h2 id="mia-forensics-title">이미지 분석</h2>
          <p>색상 채널, JPEG 재압축 차이, 노이즈와 선명도 단서를 한눈에 비교합니다.</p>
        </div>
      </div>
      <div class="mia-upload" data-mia-forensics-drop tabindex="0" role="button" aria-label="분석할 이미지 선택">
        <div>
          <div class="mia-upload-icon" aria-hidden="true">🔎</div>
          <div class="mia-upload-title">분석할 이미지를 놓거나 클릭해서 선택하세요</div>
          <div class="mia-upload-copy">모든 스캔은 이 기기에서 생성되며, 각 결과를 PNG로 저장할 수 있습니다</div>
        </div>
      </div>
      <input class="mia-file-input" data-mia-forensics-input type="file" accept="image/*">
      <div class="mia-file-info" data-mia-forensics-file-info>아직 선택된 이미지가 없습니다.</div>

      <div class="mia-controls" aria-label="이미지 분석 옵션">
        <div class="mia-field">
          <label for="mia-analysis-max-side">분석 최대 변</label>
          <select id="mia-analysis-max-side" data-mia-forensics-max-side>
            <option value="640">640px · 빠름</option>
            <option value="960" selected>960px · 권장</option>
            <option value="1280">1280px · 자세히</option>
          </select>
        </div>
        <div class="mia-field">
          <label for="mia-analysis-jpeg-quality">JPEG 재압축 품질 <output data-mia-output="jpeg-quality">75</output></label>
          <input id="mia-analysis-jpeg-quality" data-mia-forensics-control="jpeg-quality" type="range" min="45" max="95" step="1" value="75">
        </div>
        <div class="mia-field">
          <label for="mia-analysis-ela-gain">차이 강조 <output data-mia-output="ela-gain">16</output></label>
          <input id="mia-analysis-ela-gain" data-mia-forensics-control="ela-gain" type="range" min="1" max="40" step="1" value="16">
        </div>
        <div class="mia-field">
          <label for="mia-analysis-noise-gain">노이즈 강조 <output data-mia-output="noise-gain">6</output></label>
          <input id="mia-analysis-noise-gain" data-mia-forensics-control="noise-gain" type="range" min="1" max="20" step="1" value="6">
        </div>
        <div class="mia-field">
          <label for="mia-analysis-sharp-gain">선명도 강조 <output data-mia-output="sharp-gain">2</output></label>
          <input id="mia-analysis-sharp-gain" data-mia-forensics-control="sharp-gain" type="range" min="1" max="12" step="1" value="2">
        </div>
      </div>
      <div class="mia-analysis-toolbar">
        <p class="mia-scan-note">재압축 차이와 노이즈는 편집 여부의 단서일 수 있지만, 이미지의 진위나 출처를 단정하지는 않습니다.</p>
        <button class="mia-compact-button" data-mia-forensics-run type="button">옵션으로 다시 분석</button>
      </div>
      <div class="mia-status" data-mia-forensics-status aria-live="polite">이미지를 선택하면 12가지 분석 결과를 생성합니다.</div>
      <div class="mia-scan-grid" data-mia-scan-grid>
        ${scanCard('original', '원본')}
        ${scanCard('ela', 'JPEG 재압축 차이')}
        ${scanCard('red', '빨강 채널')}
        ${scanCard('green', '초록 채널')}
        ${scanCard('blue', '파랑 채널')}
        ${scanCard('noise', '노이즈 잔차')}
        ${scanCard('sharpness', '라플라시안 선명도')}
        ${scanCard('hue', 'HSV 색상')}
        ${scanCard('saturation', 'HSV 채도')}
        ${scanCard('value', 'HSV 명도')}
        ${scanCard('cb', 'YCbCr Cb')}
        ${scanCard('cr', 'YCbCr Cr')}
      </div>
    </section>
  `;

  const el = {
    drop: root.querySelector('[data-mia-forensics-drop]'),
    input: root.querySelector('[data-mia-forensics-input]'),
    fileInfo: root.querySelector('[data-mia-forensics-file-info]'),
    maxSide: root.querySelector('[data-mia-forensics-max-side]'),
    run: root.querySelector('[data-mia-forensics-run]'),
    status: root.querySelector('[data-mia-forensics-status]'),
    canvases: Object.fromEntries(
      Array.from(root.querySelectorAll('[data-mia-canvas]')).map(canvas => [canvas.dataset.miaCanvas, canvas]),
    ),
  };
  const controlInputs = Array.from(root.querySelectorAll('[data-mia-forensics-control]'));
  const state = {
    file: null,
    image: null,
    baseCanvas: null,
    busy: false,
    runId: 0,
    selectionId: 0,
    rerunTimer: null,
    pendingRerun: false,
    analysisReady: false,
  };

  const setStatus = (message, tone = 'info') => {
    el.status.textContent = message;
    el.status.dataset.tone = tone === 'info' ? '' : tone;
  };

  const updateControlOutput = input => {
    const output = root.querySelector(`[data-mia-output="${input.dataset.miaForensicsControl}"]`);
    if (output) output.value = input.value;
  };

  const scheduleRerun = () => {
    if (!state.image) return;
    if (state.busy) {
      state.pendingRerun = true;
      return;
    }
    window.clearTimeout(state.rerunTimer);
    state.rerunTimer = window.setTimeout(() => analyseImage(), 180);
  };

  const openPicker = () => {
    if (!state.busy) el.input.click();
  };

  el.drop.addEventListener('click', openPicker);
  el.drop.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  });
  addDropHandlers(el.drop, files => receiveForensicsFile(files[0]));
  el.input.addEventListener('change', event => {
    receiveForensicsFile(event.target.files?.[0]);
    event.target.value = '';
  });
  el.maxSide.addEventListener('change', scheduleRerun);
  el.run.addEventListener('click', () => analyseImage());
  controlInputs.forEach(input => {
    updateControlOutput(input);
    input.addEventListener('input', () => {
      updateControlOutput(input);
      scheduleRerun();
    });
  });
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-mia-download-scan]');
    if (!button || !state.file || !state.analysisReady) return;
    const name = button.dataset.miaDownloadScan;
    const canvas = el.canvases[name];
    if (!canvas?.width) return;
    downloadCanvas(canvas, `${fileStem(state.file.name)}-analysis-${name}.png`).catch(error => {
      setStatus(error.message || '분석 이미지를 저장하지 못했습니다.', 'error');
    });
  });

  async function receiveForensicsFile(file) {
    if (!file) return;
    if (!isImageFile(file)) {
      setStatus('이미지 파일만 선택할 수 있습니다.', 'error');
      return;
    }

    const selectionId = ++state.selectionId;
    state.runId += 1;
    state.analysisReady = false;
    setScanDownloadState(root, false);
    state.busy = true;
    el.run.disabled = true;
    setStatus('분석할 이미지를 읽고 있습니다…', 'working');
    try {
      const image = await loadImageFromFile(file);
      if (selectionId !== state.selectionId) return;
      state.file = file;
      state.image = image;
      const dimensions = `${image.naturalWidth || image.width}×${image.naturalHeight || image.height}`;
      el.fileInfo.textContent = `${file.name} · ${formatFileSize(file.size)} · 원본 ${dimensions}`;
      state.busy = false;
      el.run.disabled = false;
      await analyseImage();
    } catch (error) {
      if (selectionId !== state.selectionId) return;
      state.busy = false;
      el.run.disabled = false;
      setStatus(error.message || '이미지를 읽지 못했습니다.', 'error');
    }
  }

  async function analyseImage() {
    if (!state.image || state.busy) return;
    const runId = ++state.runId;
    state.busy = true;
    el.run.disabled = true;
    setStatus('색상 채널과 시각적 단서를 분석하는 중입니다…', 'working');

    try {
      await nextFrame();
      const maxSide = Math.min(ANALYSIS_MAX_SIDE, Number(el.maxSide.value) || 960);
      const baseCanvas = drawImageToCanvas(state.image, maxSide);
      state.baseCanvas = baseCanvas;
      const baseContext = baseCanvas.getContext('2d', { willReadFrequently: true });
      const base = baseContext.getImageData(0, 0, baseCanvas.width, baseCanvas.height);
      if (runId !== state.runId) return;

      drawCanvas(el.canvases.original, baseCanvas);
      const splits = createChannelMaps(base);
      writeImageData(el.canvases.red, splits.red);
      writeImageData(el.canvases.green, splits.green);
      writeImageData(el.canvases.blue, splits.blue);
      writeImageData(el.canvases.hue, splits.hue);
      writeImageData(el.canvases.saturation, splits.saturation);
      writeImageData(el.canvases.value, splits.value);
      writeImageData(el.canvases.cb, splits.cb);
      writeImageData(el.canvases.cr, splits.cr);

      const gray = grayscaleData(base);
      const blurred = blurGray(gray, base.width, base.height);
      writeImageData(el.canvases.noise, createNoiseResidual(gray, blurred, base.width, base.height, Number(valueOf('noise-gain'))));
      const sharpness = createSharpnessMap(gray, base.width, base.height, Number(valueOf('sharp-gain')));
      writeImageData(el.canvases.sharpness, sharpness.imageData);

      const ela = await createElaMap(base, Number(valueOf('jpeg-quality')) / 100, Number(valueOf('ela-gain')));
      if (runId !== state.runId) return;
      writeImageData(el.canvases.ela, ela.imageData);
      state.analysisReady = true;
      setScanDownloadState(root, true);
      setStatus(
        `분석 완료 · ${base.width}×${base.height}로 처리 · JPEG 차이 최대 ${ela.maxDifference.toFixed(1)} · 평균 고주파 ${sharpness.score.toFixed(1)}`,
        'success',
      );
    } catch (error) {
      if (runId === state.runId) {
        setStatus(error.message || '이미지 분석 중 오류가 발생했습니다.', 'error');
      }
    } finally {
      if (runId === state.runId) {
        state.busy = false;
        el.run.disabled = false;
        if (state.pendingRerun) {
          state.pendingRerun = false;
          scheduleRerun();
        }
      }
    }
  }

  function valueOf(key) {
    return root.querySelector(`[data-mia-forensics-control="${key}"]`).value;
  }

  return { rerun: analyseImage };
}

function scanCard(name, title) {
  return `
    <article class="mia-scan-card">
      <div class="mia-scan-card-header">
        <h3>${title}</h3>
        <button class="mia-download-button" data-mia-download-scan="${name}" type="button" disabled>PNG</button>
      </div>
      <canvas class="mia-scan-canvas" data-mia-canvas="${name}" aria-label="${title} 분석 결과"></canvas>
    </article>
  `;
}

function setScanDownloadState(root, enabled) {
  root.querySelectorAll('[data-mia-download-scan]').forEach(button => {
    button.disabled = !enabled;
  });
}

function createChannelMaps(base) {
  const { width, height, data } = base;
  const maps = {
    red: new ImageData(width, height),
    green: new ImageData(width, height),
    blue: new ImageData(width, height),
    hue: new ImageData(width, height),
    saturation: new ImageData(width, height),
    value: new ImageData(width, height),
    cb: new ImageData(width, height),
    cr: new ImageData(width, height),
  };

  for (let offset = 0; offset < data.length; offset += 4) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    writeGray(maps.red.data, offset, red);
    writeGray(maps.green.data, offset, green);
    writeGray(maps.blue.data, offset, blue);

    const normalizedRed = red / 255;
    const normalizedGreen = green / 255;
    const normalizedBlue = blue / 255;
    const maximum = Math.max(normalizedRed, normalizedGreen, normalizedBlue);
    const minimum = Math.min(normalizedRed, normalizedGreen, normalizedBlue);
    const delta = maximum - minimum;
    let hue = 0;
    if (delta) {
      if (maximum === normalizedRed) hue = ((normalizedGreen - normalizedBlue) / delta) % 6;
      else if (maximum === normalizedGreen) hue = (normalizedBlue - normalizedRed) / delta + 2;
      else hue = (normalizedRed - normalizedGreen) / delta + 4;
      hue *= 60;
      if (hue < 0) hue += 360;
    }
    const saturation = maximum ? delta / maximum : 0;
    writeGray(maps.hue.data, offset, clampByte((hue / 360) * 255));
    writeGray(maps.saturation.data, offset, clampByte(saturation * 255));
    writeGray(maps.value.data, offset, clampByte(maximum * 255));

    const cb = 128 - .168736 * red - .331264 * green + .5 * blue;
    const cr = 128 + .5 * red - .418688 * green - .081312 * blue;
    writeGray(maps.cb.data, offset, clampByte(cb));
    writeGray(maps.cr.data, offset, clampByte(cr));
  }

  return maps;
}

function writeGray(target, offset, value) {
  target[offset] = value;
  target[offset + 1] = value;
  target[offset + 2] = value;
  target[offset + 3] = 255;
}

function grayscaleData(base) {
  const output = new Float32Array(base.width * base.height);
  for (let pixel = 0; pixel < output.length; pixel += 1) {
    const offset = pixel * 4;
    output[pixel] = .299 * base.data[offset] + .587 * base.data[offset + 1] + .114 * base.data[offset + 2];
  }
  return output;
}

function blurGray(gray, width, height) {
  const weights = [1, 4, 6, 4, 1];
  const temporary = new Float32Array(gray.length);
  const output = new Float32Array(gray.length);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let step = -2; step <= 2; step += 1) {
        const xx = Math.max(0, Math.min(width - 1, x + step));
        sum += gray[row + xx] * weights[step + 2];
      }
      temporary[row + x] = sum / 16;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let step = -2; step <= 2; step += 1) {
        const yy = Math.max(0, Math.min(height - 1, y + step));
        sum += temporary[yy * width + x] * weights[step + 2];
      }
      output[y * width + x] = sum / 16;
    }
  }
  return output;
}

function createNoiseResidual(gray, blurred, width, height, gain) {
  const output = new ImageData(width, height);
  for (let pixel = 0; pixel < gray.length; pixel += 1) {
    writeGray(output.data, pixel * 4, clampByte(128 + (gray[pixel] - blurred[pixel]) * gain));
  }
  return output;
}

function createSharpnessMap(gray, width, height, gain) {
  const magnitude = new Float32Array(gray.length);
  let sum = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let laplacian = 8 * gray[y * width + x];
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const xx = Math.max(0, Math.min(width - 1, x + dx));
          const yy = Math.max(0, Math.min(height - 1, y + dy));
          laplacian -= gray[yy * width + xx];
        }
      }
      const value = Math.abs(laplacian) * gain;
      magnitude[y * width + x] = value;
      sum += value;
    }
  }

  const upper = approximatePercentile(magnitude, .99) || 1;
  const output = new ImageData(width, height);
  for (let pixel = 0; pixel < magnitude.length; pixel += 1) {
    writeGray(output.data, pixel * 4, clampByte((magnitude[pixel] / upper) * 255));
  }
  return { imageData: output, score: sum / magnitude.length };
}

function approximatePercentile(values, percentile) {
  const step = Math.max(1, Math.floor(values.length / 50000));
  const sample = [];
  for (let index = 0; index < values.length; index += step) sample.push(values[index]);
  sample.sort((left, right) => left - right);
  return sample[Math.min(sample.length - 1, Math.floor(sample.length * percentile))] || 0;
}

async function createElaMap(base, quality, gain) {
  const scratch = document.createElement('canvas');
  scratch.width = base.width;
  scratch.height = base.height;
  const context = scratch.getContext('2d', { willReadFrequently: true });
  context.putImageData(base, 0, 0);
  const jpegBlob = await canvasToBlob(scratch, 'image/jpeg', quality);
  const recompressed = await loadImageFromBlob(jpegBlob);
  context.clearRect(0, 0, scratch.width, scratch.height);
  context.drawImage(recompressed, 0, 0, scratch.width, scratch.height);
  const jpeg = context.getImageData(0, 0, scratch.width, scratch.height);
  const output = new ImageData(base.width, base.height);
  let maxDifference = 0;

  for (let offset = 0; offset < base.data.length; offset += 4) {
    const difference = (
      Math.abs(base.data[offset] - jpeg.data[offset])
      + Math.abs(base.data[offset + 1] - jpeg.data[offset + 1])
      + Math.abs(base.data[offset + 2] - jpeg.data[offset + 2])
    ) / 3;
    maxDifference = Math.max(maxDifference, difference);
    writeGray(output.data, offset, clampByte(difference * gain));
  }
  return { imageData: output, maxDifference };
}

function drawCanvas(target, source) {
  target.width = source.width;
  target.height = source.height;
  const context = target.getContext('2d');
  context.clearRect(0, 0, target.width, target.height);
  context.drawImage(source, 0, 0);
}

function writeImageData(canvas, imageData) {
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
}

function addDropHandlers(element, onFiles) {
  element.addEventListener('dragover', event => {
    event.preventDefault();
    element.classList.add('mia-dragover');
  });
  element.addEventListener('dragleave', () => element.classList.remove('mia-dragover'));
  element.addEventListener('drop', event => {
    event.preventDefault();
    element.classList.remove('mia-dragover');
    onFiles(Array.from(event.dataTransfer?.files || []));
  });
}

function drawImageToCanvas(image, maxSide) {
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) throw new Error('이미지 크기를 확인할 수 없습니다.');
  const scale = Math.min(1, maxSide / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  return canvas;
}

function loadImageFromFile(file) {
  return loadImageFromUrl(URL.createObjectURL(file), true);
}

function loadImageFromBlob(blob) {
  return loadImageFromUrl(URL.createObjectURL(blob), true);
}

function loadImageFromUrl(url, revokeUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (revokeUrl) URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      if (revokeUrl) URL.revokeObjectURL(url);
      reject(new Error('이미지 파일을 읽을 수 없습니다. 지원되는 형식인지 확인해 주세요.'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('이미지 데이터를 생성하지 못했습니다.'));
    }, type, quality);
  });
}

async function downloadCanvas(canvas, filename) {
  const blob = await canvasToBlob(canvas, 'image/png');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isImageFile(file) {
  return Boolean(file?.type?.startsWith('image/'));
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue].map(value => clampByte(value).toString(16).padStart(2, '0')).join('')}`;
}

function fileStem(filename) {
  const stem = String(filename || 'image').replace(/\.[^./\\]+$/, '').replace(/[\\/:*?"<>|]/g, '-').trim();
  return stem || 'image';
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024 * 1024) return `${Math.max(.1, bytes / 1024).toFixed(bytes < 1024 ? 0 : 1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}
