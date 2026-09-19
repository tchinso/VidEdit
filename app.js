/**
 * Discord 20MB 미디어 도구의 통합 진입점
 * 모든 사용자 파일은 브라우저 안에서만 처리한다.
 */

const DISCORD_FREE_LIMIT_MB = 20;
const DISCORD_FREE_LIMIT_BYTES = DISCORD_FREE_LIMIT_MB * 1024 * 1024;

const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');
const progressFill = document.getElementById('progressFill');
const progressPercent = document.getElementById('progressPercent');
const processingOverlay = document.getElementById('processingOverlay');
const processingText = document.getElementById('processingText');
const processingSubtext = document.getElementById('processingSubtext');
const fileCounter = document.getElementById('fileCounter');
const cancelBtn = document.getElementById('cancelBtn');
const copyLogBtn = document.getElementById('copyLogBtn');

let isProcessing = false;
let cancelRequestedByUser = false;
let activeUploadAreas = [];
let videoCompressorModule = null;
let videoEditorModule = null;

const appLogBuffer = [];

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    tabs.forEach(item => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    tabContents.forEach(content => content.classList.toggle('active', content.id === `${target}Tab`));
  });
});

function appLog(level, message) {
  const entry = `[${new Date().toLocaleTimeString('ko-KR')}] [${level}] ${message}`;
  appLogBuffer.push(entry);
  if (appLogBuffer.length > 600) appLogBuffer.shift();
  console.log(entry);
}

function updateProgress(percent) {
  const normalized = Math.max(0, Math.min(100, Number(percent) || 0));
  progressFill.style.width = `${normalized}%`;
  progressPercent.textContent = `${Math.round(normalized)}%`;
}

function beginProcessing({ text, subtext, uploadAreas = [], cancelable = false }) {
  isProcessing = true;
  cancelRequestedByUser = false;
  activeUploadAreas = uploadAreas;
  uploadAreas.forEach(area => area?.classList.add('processing'));
  processingText.textContent = text;
  processingSubtext.textContent = subtext;
  fileCounter.textContent = '';
  updateProgress(0);
  cancelBtn.hidden = !cancelable;
  cancelBtn.disabled = false;
  cancelBtn.textContent = '✕ 취소';
  processingOverlay.classList.add('active');
}

function finishProcessing() {
  activeUploadAreas.forEach(area => area?.classList.remove('processing'));
  activeUploadAreas = [];
  processingOverlay.classList.remove('active');
  cancelBtn.hidden = true;
  cancelBtn.disabled = false;
  cancelBtn.textContent = '✕ 취소';
  isProcessing = false;
  cancelRequestedByUser = false;
  updateProgress(0);
}

cancelBtn.addEventListener('click', () => {
  cancelRequestedByUser = true;
  cancelBtn.disabled = true;
  cancelBtn.textContent = '취소하는 중...';
  videoCompressorModule?.requestCancel?.();
  videoEditorModule?.requestCancel?.();
});

copyLogBtn.addEventListener('click', async () => {
  const videoLogs = videoCompressorModule?.getLogs?.() || '';
  const text = [
    '=== Discord 20MB 미디어 도구 처리 로그 ===',
    `주소: ${location.href}`,
    `브라우저: ${navigator.userAgent}`,
    `시각: ${new Date().toISOString()}`,
    '',
    '--- 앱 ---',
    appLogBuffer.length ? appLogBuffer.join('\n') : '(로그 없음)',
    '',
    '--- 동영상 압축 ---',
    videoLogs || '(로그 없음)',
  ].join('\n');

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  copyLogBtn.textContent = '✅ 로그를 복사했습니다';
  copyLogBtn.classList.add('copied');
  setTimeout(() => {
    copyLogBtn.textContent = '📋 처리 로그 복사';
    copyLogBtn.classList.remove('copied');
  }, 2000);
});

function setupFilePicker(area, input, onFiles) {
  const openPicker = () => {
    if (!isProcessing) input.click();
  };

  area.addEventListener('click', openPicker);
  area.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  });
  area.addEventListener('dragover', event => {
    event.preventDefault();
    if (!isProcessing) area.classList.add('dragover');
  });
  area.addEventListener('dragleave', () => area.classList.remove('dragover'));
  area.addEventListener('drop', event => {
    event.preventDefault();
    area.classList.remove('dragover');
    if (!isProcessing) onFiles(event.dataTransfer.files);
  });
  input.addEventListener('change', event => {
    if (!isProcessing) onFiles(event.target.files);
  });
}

window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());

// ============================================================
// 이미지 압축 (Rust/WASM)
// ============================================================

const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const imageResults = document.getElementById('results');
let wasmReady = false;
let wasmInitError = null;
let compressor = null;

setupFilePicker(uploadArea, fileInput, handleImages);

async function ensureWasm() {
  if (wasmReady) return;
  if (wasmInitError) throw wasmInitError;

  try {
    const wasmModule = await import('./image_compressor.js');
    if (typeof wasmModule.default !== 'function') {
      throw new Error('이미지 압축 모듈을 초기화하지 못했습니다.');
    }
    await wasmModule.default({ module_or_path: './image_compressor_bg.wasm' });
    compressor = new wasmModule.ImageCompressor();
    wasmReady = true;
    appLog('정보', '이미지 엔진(Rust/WASM)을 준비했습니다.');
  } catch (error) {
    wasmInitError = error;
    appLog('오류', `이미지 엔진 초기화 실패: ${error.message}`);
    throw error;
  }
}

async function handleImages(files) {
  const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
  fileInput.value = '';
  if (!imageFiles.length) {
    alert('이미지 파일을 선택해 주세요.');
    return;
  }

  beginProcessing({
    text: '🦀 이미지를 압축하고 있습니다...',
    subtext: '이미지 엔진을 준비하는 중입니다.',
    uploadAreas: [uploadArea],
  });

  try {
    await ensureWasm();
    for (let index = 0; index < imageFiles.length; index++) {
      const file = imageFiles[index];
      processingText.textContent = '🦀 이미지를 압축하고 있습니다...';
      processingSubtext.textContent = truncate(file.name, 52);
      fileCounter.textContent = `${index + 1} / ${imageFiles.length}`;
      updateProgress((index / imageFiles.length) * 100);

      try {
        const result = await compressImage(file);
        addImageResult(file, result);
        appLog('정보', `이미지 압축 완료: ${truncate(file.name, 36)} (${formatMegabytes(file.size)} → ${formatMegabytes(result.blob.size)})`);
      } catch (error) {
        appLog('오류', `이미지 압축 실패: ${truncate(file.name, 36)} — ${error.message}`);
        addErrorCard(imageResults, file, error.message);
      }
    }
    updateProgress(100);
  } catch (error) {
    addErrorCard(imageResults, { name: '이미지 압축' }, error.message);
  } finally {
    finishProcessing();
  }
}

async function compressImage(file) {
  if (file.size <= DISCORD_FREE_LIMIT_BYTES) {
    return { blob: file, isLossless: true };
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const compressed = compressor.compress_to_target_size(data, DISCORD_FREE_LIMIT_BYTES);
  if (!compressed.length) throw new Error('이미지 압축에 실패했습니다.');
  return { blob: new Blob([compressed], { type: 'image/jpeg' }), isLossless: false };
}

function addImageResult(file, result) {
  const previewUrl = URL.createObjectURL(result.blob);
  const outputExtension = result.isLossless ? getExtensionFromName(file.name, 'png') : 'jpg';
  const change = getSizeChangeText(file.size, result.blob.size);
  const card = document.createElement('article');
  card.className = 'result-card';
  card.innerHTML = `
    <img class="preview" src="${previewUrl}" alt="압축 결과 미리보기">
    <div class="info">
      <div class="filename">${escapeHtml(file.name)}</div>
      <div class="stats">
        <span class="stat before">원본 ${formatMegabytes(file.size)}</span>
        <span class="stat after">결과 ${formatMegabytes(result.blob.size)}</span>
        <span class="stat ratio">${change}</span>
        <span class="stat">${result.isLossless ? '이미 20MB 이하' : 'Rust/WASM'}</span>
      </div>
    </div>
    <button class="download-btn" type="button">⬇️ 다운로드</button>
  `;
  addDownloadHandler(card.querySelector('.download-btn'), previewUrl, file.name, 'compressed', outputExtension);
  imageResults.prepend(card);
}

// ============================================================
// 동영상 압축
// ============================================================

const videoUploadArea = document.getElementById('videoUploadArea');
const videoInput = document.getElementById('videoInput');
const videoResults = document.getElementById('videoResults');

setupFilePicker(videoUploadArea, videoInput, files => {
  if (files.length) handleVideoCompression(files[0]);
});

async function loadVideoCompressor() {
  if (!videoCompressorModule) {
    videoCompressorModule = await import('./video-compressor.js');
  }
  return videoCompressorModule;
}

async function handleVideoCompression(file) {
  videoInput.value = '';
  if (!isVideoFile(file)) {
    alert('동영상 파일을 선택해 주세요.');
    return;
  }

  beginProcessing({
    text: '🎬 동영상 엔진을 준비하는 중입니다...',
    subtext: '첫 실행에서는 잠시 시간이 걸릴 수 있습니다.',
    uploadAreas: [videoUploadArea],
    cancelable: true,
  });

  try {
    const module = await loadVideoCompressor();
    if (cancelRequestedByUser) throw new Error('작업이 취소되었습니다.');
    const result = await module.compressVideo(
      file,
      updateProgress,
      status => {
        processingText.textContent = '🎬 동영상을 압축하고 있습니다...';
        processingSubtext.textContent = status;
      },
    );
    addVideoResultCard(videoResults, file, result, {
      suffix: 'compressed',
      label: '동영상 압축',
      warning: result.degraded ? '20MB 이하로 줄이기 위해 여러 번 시도했지만 목표를 넘었습니다. Discord에서 업로드가 거부될 수 있습니다.' : '',
    });
    appLog('정보', `동영상 압축 완료: ${truncate(file.name, 36)} (${formatMegabytes(result.originalSize)} → ${formatMegabytes(result.compressedSize)})`);
  } catch (error) {
    if (isCancellation(error)) {
      appLog('정보', '동영상 압축을 취소했습니다.');
    } else {
      console.error('동영상 압축 오류:', error);
      appLog('오류', `동영상 압축 실패: ${truncate(file.name, 36)} — ${error.message}`);
      addErrorCard(videoResults, file, error.message || '동영상 압축 중 오류가 발생했습니다.');
    }
  } finally {
    finishProcessing();
  }
}

// ============================================================
// 속도 조절 / 영상 자르기
// ============================================================

const speedUploadArea = document.getElementById('speedUploadArea');
const speedInput = document.getElementById('speedInput');
const speedControls = document.getElementById('speedControls');
const speedFileInfo = document.getElementById('speedFileInfo');
const speedPreview = document.getElementById('speedPreview');
const speedRate = document.getElementById('speedRate');
const speedPreset = document.getElementById('speedPreset');
const speedRangeFields = document.getElementById('speedRangeFields');
const speedStart = document.getElementById('speedStart');
const speedEnd = document.getElementById('speedEnd');
const speedEstimate = document.getElementById('speedEstimate');
const speedProcessBtn = document.getElementById('speedProcessBtn');
const speedResults = document.getElementById('speedResults');

const trimUploadArea = document.getElementById('trimUploadArea');
const trimInput = document.getElementById('trimInput');
const trimControls = document.getElementById('trimControls');
const trimFileInfo = document.getElementById('trimFileInfo');
const trimPreview = document.getElementById('trimPreview');
const trimStart = document.getElementById('trimStart');
const trimEnd = document.getElementById('trimEnd');
const trimEstimate = document.getElementById('trimEstimate');
const trimProcessBtn = document.getElementById('trimProcessBtn');
const trimResults = document.getElementById('trimResults');

let speedFileState = null;
let trimFileState = null;

setupFilePicker(speedUploadArea, speedInput, files => {
  if (files.length) selectEditorFile('speed', files[0]);
});
setupFilePicker(trimUploadArea, trimInput, files => {
  if (files.length) selectEditorFile('trim', files[0]);
});

async function loadVideoEditor() {
  if (!videoEditorModule) {
    videoEditorModule = await import('./video-editor.js');
  }
  return videoEditorModule;
}

function createEditorAudioContext() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return null;
  try {
    const context = new AudioContextConstructor();
    // 클릭 이벤트 안에서 즉시 재개해 모바일 브라우저의 자동 재생 제한을 피한다.
    context.resume().catch(() => {});
    return context;
  } catch {
    return null;
  }
}

async function closeEditorAudioContext(context) {
  if (context && context.state !== 'closed') {
    await context.close().catch(() => {});
  }
}

async function selectEditorFile(kind, file) {
  const input = kind === 'speed' ? speedInput : trimInput;
  const results = kind === 'speed' ? speedResults : trimResults;
  input.value = '';
  if (!isVideoFile(file)) {
    alert('동영상 파일을 선택해 주세요.');
    return;
  }

  try {
    const editor = await loadVideoEditor();
    const metadata = await editor.getVideoMetadata(file);
    const state = { file, metadata, previewUrl: URL.createObjectURL(file) };

    if (kind === 'speed') {
      releaseEditorPreview(speedPreview, speedFileState);
      speedFileState = state;
      speedPreview.src = state.previewUrl;
      speedFileInfo.innerHTML = createFileInfo(file, metadata);
      const maxTime = getMaxTenthSecond(metadata.duration);
      speedStart.max = maxTime;
      speedEnd.max = maxTime;
      speedEnd.value = maxTime;
      speedControls.hidden = false;
      updateSpeedEstimate();
    } else {
      releaseEditorPreview(trimPreview, trimFileState);
      trimFileState = state;
      trimPreview.src = state.previewUrl;
      trimFileInfo.innerHTML = createFileInfo(file, metadata);
      const maxTime = getMaxTenthSecond(metadata.duration);
      trimStart.max = maxTime;
      trimEnd.max = maxTime;
      trimEnd.value = maxTime;
      trimControls.hidden = false;
      updateTrimEstimate();
    }
  } catch (error) {
    appLog('오류', `동영상 정보 읽기 실패: ${error.message}`);
    addErrorCard(results, file, error.message || '동영상 정보를 읽지 못했습니다.');
  }
}

function releaseEditorPreview(preview, state) {
  preview.pause();
  preview.removeAttribute('src');
  preview.load();
  if (state?.previewUrl) URL.revokeObjectURL(state.previewUrl);
}

function createFileInfo(file, metadata) {
  return `<strong>${escapeHtml(file.name)}</strong><br>길이 ${formatDuration(metadata.duration)} · ${metadata.width} × ${metadata.height} · ${formatMegabytes(file.size)}`;
}

function getSpeedScope() {
  return document.querySelector('input[name="speedScope"]:checked')?.value || 'whole';
}

function updateSpeedEstimate() {
  if (!speedFileState) return;
  const duration = speedFileState.metadata.duration;
  const speed = Number(speedRate.value);
  const scope = getSpeedScope();
  speedRangeFields.hidden = scope !== 'range';

  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    speedEstimate.textContent = '속도를 0.25배에서 4배 사이로 입력해 주세요.';
    return;
  }

  let outputDuration;
  if (scope === 'range') {
    const start = Number(speedStart.value);
    const end = Number(speedEnd.value);
    if (!isValidRange(start, end, duration)) {
      speedEstimate.textContent = `유효한 구간을 입력해 주세요. (0초 ~ ${formatDuration(duration)})`;
      return;
    }
    outputDuration = duration - (end - start) + (end - start) / speed;
  } else {
    outputDuration = duration / speed;
  }
  speedEstimate.textContent = `예상 결과 길이: ${formatDuration(outputDuration)} (원본 ${formatDuration(duration)})`;
}

function updateTrimEstimate() {
  if (!trimFileState) return;
  const duration = trimFileState.metadata.duration;
  const start = Number(trimStart.value);
  const end = Number(trimEnd.value);
  if (!isValidRange(start, end, duration)) {
    trimEstimate.textContent = `유효한 구간을 입력해 주세요. (0초 ~ ${formatDuration(duration)})`;
    return;
  }
  trimEstimate.textContent = `저장할 길이: ${formatDuration(end - start)} (원본 ${formatDuration(duration)})`;
}

speedPreset.addEventListener('change', () => {
  if (speedPreset.value) speedRate.value = speedPreset.value;
  updateSpeedEstimate();
});
speedRate.addEventListener('input', () => {
  speedPreset.value = '';
  updateSpeedEstimate();
});
[speedStart, speedEnd].forEach(input => input.addEventListener('input', updateSpeedEstimate));
document.querySelectorAll('input[name="speedScope"]').forEach(input => input.addEventListener('change', updateSpeedEstimate));
[trimStart, trimEnd].forEach(input => input.addEventListener('input', updateTrimEstimate));

speedProcessBtn.addEventListener('click', processSpeedChange);
trimProcessBtn.addEventListener('click', processTrim);

async function processSpeedChange() {
  if (!speedFileState || isProcessing) return;
  const scope = getSpeedScope();
  const rate = Number(speedRate.value);
  const options = {
    type: 'speed',
    scope,
    speed: rate,
    start: Number(speedStart.value),
    end: Number(speedEnd.value),
  };
  const description = scope === 'range'
    ? `${formatSecondsValue(options.start)}~${formatSecondsValue(options.end)}초 구간 ${rate}배`
    : `전체 ${rate}배`;
  const editorAudioContext = createEditorAudioContext();

  speedProcessBtn.disabled = true;
  beginProcessing({
    text: '⏩ 속도를 적용하고 있습니다...',
    subtext: description,
    uploadAreas: [speedUploadArea],
    cancelable: true,
  });

  try {
    const editor = await loadVideoEditor();
    if (cancelRequestedByUser) throw new Error('작업이 취소되었습니다.');
    const result = await editor.transformVideo(
      speedFileState.file,
      options,
      updateProgress,
      status => { processingSubtext.textContent = status; },
      editorAudioContext,
    );
    addVideoResultCard(speedResults, speedFileState.file, result, {
      suffix: 'speed',
      label: `속도 조절 · ${description}`,
      warning: result.exceedsTarget ? '여러 번 다시 저장했지만 20MB 이하로 줄지 않았습니다. 압축 도구를 한 번 더 사용해 주세요.' : '',
    });
    appLog('정보', `속도 조절 완료: ${truncate(speedFileState.file.name, 36)} (${description})`);
  } catch (error) {
    if (isCancellation(error)) {
      appLog('정보', '속도 조절을 취소했습니다.');
    } else {
      console.error('속도 조절 오류:', error);
      appLog('오류', `속도 조절 실패: ${error.message}`);
      addErrorCard(speedResults, speedFileState.file, error.message || '속도 조절 중 오류가 발생했습니다.');
    }
  } finally {
    await closeEditorAudioContext(editorAudioContext);
    speedProcessBtn.disabled = false;
    finishProcessing();
  }
}

async function processTrim() {
  if (!trimFileState || isProcessing) return;
  const options = {
    type: 'trim',
    start: Number(trimStart.value),
    end: Number(trimEnd.value),
  };
  const description = `${formatSecondsValue(options.start)}초 ~ ${formatSecondsValue(options.end)}초`;
  const editorAudioContext = createEditorAudioContext();

  trimProcessBtn.disabled = true;
  beginProcessing({
    text: '✂️ 선택 구간을 자르고 있습니다...',
    subtext: description,
    uploadAreas: [trimUploadArea],
    cancelable: true,
  });

  try {
    const editor = await loadVideoEditor();
    if (cancelRequestedByUser) throw new Error('작업이 취소되었습니다.');
    const result = await editor.transformVideo(
      trimFileState.file,
      options,
      updateProgress,
      status => { processingSubtext.textContent = status; },
      editorAudioContext,
    );
    addVideoResultCard(trimResults, trimFileState.file, result, {
      suffix: 'trim',
      label: `영상 자르기 · ${description}`,
      warning: result.exceedsTarget ? '여러 번 다시 저장했지만 20MB 이하로 줄지 않았습니다. 압축 도구를 한 번 더 사용해 주세요.' : '',
    });
    appLog('정보', `영상 자르기 완료: ${truncate(trimFileState.file.name, 36)} (${description})`);
  } catch (error) {
    if (isCancellation(error)) {
      appLog('정보', '영상 자르기를 취소했습니다.');
    } else {
      console.error('영상 자르기 오류:', error);
      appLog('오류', `영상 자르기 실패: ${error.message}`);
      addErrorCard(trimResults, trimFileState.file, error.message || '영상 자르기 중 오류가 발생했습니다.');
    }
  } finally {
    await closeEditorAudioContext(editorAudioContext);
    trimProcessBtn.disabled = false;
    finishProcessing();
  }
}

// ============================================================
// 결과 / 공통 도우미
// ============================================================

function addVideoResultCard(container, file, result, options) {
  const outputSize = result.outputSize ?? result.compressedSize ?? result.blob.size;
  const originalSize = result.originalSize ?? file.size;
  const previewUrl = URL.createObjectURL(result.blob);
  const outputDuration = result.outputDuration;
  const originalDuration = result.originalDuration;
  const durationStat = Number.isFinite(outputDuration) && Number.isFinite(originalDuration)
    ? `<span class="stat">길이 ${formatDuration(originalDuration)} → ${formatDuration(outputDuration)}</span>`
    : '';
  const warning = options.warning || '';
  const card = document.createElement('article');
  card.className = 'result-card';
  if (warning) card.style.borderColor = '#faa61a';
  card.innerHTML = `
    <video class="video-preview" src="${previewUrl}" muted playsinline preload="metadata"></video>
    <div class="info">
      <div class="filename">${escapeHtml(file.name)}</div>
      <div class="stats">
        <span class="stat before">원본 ${formatMegabytes(originalSize)}</span>
        <span class="stat after">결과 ${formatMegabytes(outputSize)}</span>
        <span class="stat ratio">${getSizeChangeText(originalSize, outputSize)}</span>
        ${durationStat}
        <span class="stat">${escapeHtml(options.label)}</span>
      </div>
      ${warning ? `<div class="warning-text">⚠️ ${escapeHtml(warning)}</div>` : ''}
    </div>
    <button class="download-btn" type="button">⬇️ 다운로드</button>
  `;

  const video = card.querySelector('video');
  video.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(video.duration) && video.duration > 0.1) video.currentTime = 0.1;
  }, { once: true });
  addDownloadHandler(
    card.querySelector('.download-btn'),
    previewUrl,
    file.name,
    options.suffix,
    getVideoExtension(result.blob),
  );
  container.prepend(card);
}

function addErrorCard(container, file, message) {
  const card = document.createElement('article');
  card.className = 'result-card';
  card.style.borderColor = '#f04747';
  card.innerHTML = `
    <div class="preview" style="display:flex;align-items:center;justify-content:center;font-size:2rem">❌</div>
    <div class="info">
      <div class="filename">${escapeHtml(file.name || '처리 오류')}</div>
      <div class="stats"><span class="stat" style="color:#ff9292">오류: ${escapeHtml(message || '알 수 없는 오류')}</span></div>
    </div>
  `;
  container.prepend(card);
}

function addDownloadHandler(button, url, originalName, suffix, extension) {
  button.addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${originalName.replace(/\.[^.]+$/, '')}_${suffix}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  });
}

function getVideoExtension(blob) {
  return blob.type.includes('webm') ? 'webm' : 'mp4';
}

function getExtensionFromName(name, fallback) {
  const match = name.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : fallback;
}

function isVideoFile(file) {
  return Boolean(file) && (
    file.type.startsWith('video/') || /\.(mp4|m4v|webm|mov|avi|mpeg|mpg|ogv)$/i.test(file.name)
  );
}

function isValidRange(start, end, duration) {
  return Number.isFinite(start)
    && Number.isFinite(end)
    && isTenthSecond(start)
    && isTenthSecond(end)
    && start >= 0
    && end > start
    && end <= duration + 0.01
    && end - start >= 0.1;
}

function isTenthSecond(value) {
  return Math.abs(value * 10 - Math.round(value * 10)) < 0.000001;
}

function isCancellation(error) {
  return cancelRequestedByUser || /취소/.test(error?.message || '');
}

function getSizeChangeText(originalSize, outputSize) {
  if (!originalSize) return '크기 정보 없음';
  const percent = ((outputSize - originalSize) / originalSize) * 100;
  if (Math.abs(percent) < 0.05) return '크기 변화 없음';
  return percent < 0 ? `${Math.abs(percent).toFixed(1)}% 감소` : `${percent.toFixed(1)}% 증가`;
}

function formatMegabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '-';
  const tenths = Math.max(0, Math.round(seconds * 10));
  const hours = Math.floor(tenths / 36_000);
  const minutes = Math.floor((tenths % 36_000) / 600);
  const remainingSeconds = (tenths % 600) / 10;
  const secondText = remainingSeconds.toFixed(1).padStart(4, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secondText}` : `${minutes}:${secondText}`;
}

function formatSecondsValue(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '-';
}

function getMaxTenthSecond(duration) {
  return (Math.floor((duration + 0.000001) * 10) / 10).toFixed(1);
}

function truncate(value, maxLength) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = value;
  return element.innerHTML;
}

ensureWasm().catch(error => {
  console.error('이미지 엔진 초기화 오류:', error);
});
