/**
 * 브라우저 내 영상 편집 모듈
 *
 * Canvas와 MediaRecorder를 사용해 속도 변경과 구간 자르기를 처리한다.
 * 처리 결과는 Discord 무료 플랜의 20MB 제한을 목표로 다시 인코딩된다.
 */

const TARGET_SIZE_BYTES = 20 * 1024 * 1024;
const SAFE_TARGET_SIZE_BYTES = 19 * 1024 * 1024;
const AUDIO_BITRATE = 64_000;
const MIN_VIDEO_BITRATE = 180_000;
const MAX_VIDEO_BITRATE = 10_000_000;
const FRAME_RATE = 30;
const MAX_OUTPUT_EDGE = 1280;
const MAX_ATTEMPTS = 3;

export const EDIT_CANCEL_MESSAGE = '작업이 취소되었습니다.';

let cancelRequested = false;

export function requestCancel() {
  cancelRequested = true;
}

export async function getVideoMetadata(file) {
  if (!file) {
    throw new Error('동영상 파일을 선택해 주세요.');
  }

  const video = document.createElement('video');
  const objectUrl = URL.createObjectURL(file);
  video.preload = 'metadata';
  video.src = objectUrl;

  try {
    await waitForEvent(video, 'loadedmetadata', '동영상 정보를 읽지 못했습니다.');
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error('재생 시간을 확인할 수 없는 동영상입니다.');
    }

    return {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
    video.removeAttribute('src');
    video.load();
  }
}

/**
 * @param {File} file
 * @param {{ type: 'speed'|'trim', speed?: number, scope?: 'whole'|'range', start?: number, end?: number }} options
 */
export async function transformVideo(file, options, onProgress, onStatus, sharedAudioContext = null) {
  cancelRequested = false;
  const info = await getVideoMetadata(file);
  const operation = normalizeOperation(options, info.duration);
  const outputDuration = estimateOutputDuration(operation, info.duration);
  const dimensions = getOutputDimensions(info.width, info.height);
  let videoBitrate = getInitialBitrate(outputDuration);
  let lastResult = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (cancelRequested) throw new Error(EDIT_CANCEL_MESSAGE);
    if (attempt > 0) {
      onStatus?.(`Discord 20MB에 맞춰 다시 저장 중... (${attempt + 1}/${MAX_ATTEMPTS})`);
    }

    const blob = await recordEditedVideo(
      file,
      operation,
      dimensions,
      videoBitrate,
      onProgress,
      onStatus,
      sharedAudioContext,
    );
    lastResult = blob;

    if (blob.size <= TARGET_SIZE_BYTES || attempt === MAX_ATTEMPTS - 1) {
      return {
        blob,
        originalSize: file.size,
        outputSize: blob.size,
        originalDuration: info.duration,
        outputDuration,
        exceedsTarget: blob.size > TARGET_SIZE_BYTES,
        engine: 'mediarecorder',
      };
    }

    const scale = (SAFE_TARGET_SIZE_BYTES / blob.size) * 0.9;
    const nextBitrate = Math.floor(videoBitrate * scale);
    if (nextBitrate >= videoBitrate || nextBitrate < MIN_VIDEO_BITRATE) {
      return {
        blob,
        originalSize: file.size,
        outputSize: blob.size,
        originalDuration: info.duration,
        outputDuration,
        exceedsTarget: true,
        engine: 'mediarecorder',
      };
    }
    videoBitrate = Math.max(MIN_VIDEO_BITRATE, nextBitrate);
  }

  // 반복문은 항상 반환하지만, 정적 분석기와 예외 상황을 위한 방어 코드다.
  throw new Error(lastResult ? '영상을 20MB 이하로 저장하지 못했습니다.' : '영상 편집에 실패했습니다.');
}

function normalizeOperation(options, duration) {
  if (!options || !['speed', 'trim'].includes(options.type)) {
    throw new Error('지원하지 않는 편집 작업입니다.');
  }

  if (options.type === 'trim') {
    const start = parseTime(options.start, '시작 시간');
    const end = parseTime(options.end, '종료 시간');
    validateRange(start, end, duration);
    return { type: 'trim', sourceStart: start, sourceEnd: end };
  }

  const speed = Number(options.speed);
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    throw new Error('속도는 0.25배에서 4배 사이로 입력해 주세요.');
  }

  if (options.scope === 'range') {
    const rangeStart = parseTime(options.start, '구간 시작 시간');
    const rangeEnd = parseTime(options.end, '구간 종료 시간');
    validateRange(rangeStart, rangeEnd, duration);
    return {
      type: 'speed',
      scope: 'range',
      speed,
      sourceStart: 0,
      sourceEnd: duration,
      rangeStart,
      rangeEnd,
    };
  }

  return {
    type: 'speed',
    scope: 'whole',
    speed,
    sourceStart: 0,
    sourceEnd: duration,
    rangeStart: 0,
    rangeEnd: duration,
  };
}

function parseTime(value, label) {
  const time = Number(value);
  if (!Number.isFinite(time) || time < 0) {
    throw new Error(`${label}은(는) 0초 이상의 숫자로 입력해 주세요.`);
  }
  const tenths = Math.round(time * 10);
  if (Math.abs(time * 10 - tenths) > 0.000001) {
    throw new Error(`${label}은(는) 0.1초 단위로 입력해 주세요.`);
  }
  return tenths / 10;
}

function validateRange(start, end, duration) {
  if (start >= end) {
    throw new Error('종료 시간은 시작 시간보다 뒤여야 합니다.');
  }
  if (end > duration + 0.01) {
    throw new Error(`종료 시간은 영상 길이(${formatSeconds(duration)})를 넘을 수 없습니다.`);
  }
  if (end - start < 0.1) {
    throw new Error('편집 구간은 0.1초 이상이어야 합니다.');
  }
}

function estimateOutputDuration(operation, sourceDuration) {
  if (operation.type === 'trim') {
    return operation.sourceEnd - operation.sourceStart;
  }

  if (operation.scope === 'whole') {
    return sourceDuration / operation.speed;
  }

  const rangeDuration = operation.rangeEnd - operation.rangeStart;
  return sourceDuration - rangeDuration + (rangeDuration / operation.speed);
}

function getInitialBitrate(outputDuration) {
  const totalBitrate = Math.floor((SAFE_TARGET_SIZE_BYTES * 8) / Math.max(outputDuration, 1));
  return clamp(totalBitrate - AUDIO_BITRATE, MIN_VIDEO_BITRATE, MAX_VIDEO_BITRATE);
}

function getOutputDimensions(width, height) {
  if (!width || !height) {
    throw new Error('동영상 해상도를 확인할 수 없습니다.');
  }

  const scale = Math.min(1, MAX_OUTPUT_EDGE / Math.max(width, height));
  return {
    width: Math.max(2, Math.floor((width * scale) / 2) * 2),
    height: Math.max(2, Math.floor((height * scale) / 2) * 2),
  };
}

async function recordEditedVideo(file, operation, dimensions, videoBitrate, onProgress, onStatus, sharedAudioContext) {
  if (cancelRequested) throw new Error(EDIT_CANCEL_MESSAGE);

  const video = document.createElement('video');
  const objectUrl = URL.createObjectURL(file);
  const canvas = document.createElement('canvas');
  let animationFrame = null;
  let audioContext = sharedAudioContext;
  const ownsAudioContext = !sharedAudioContext;
  let canvasStream = null;
  let mediaStream = null;
  let recorder = null;
  let stopRecording = () => {};

  video.src = objectUrl;
  video.preload = 'auto';
  video.playsInline = true;
  video.muted = false;
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;

  try {
    onStatus?.('동영상을 준비하는 중...');
    await waitForEvent(video, 'loadedmetadata', '동영상을 읽지 못했습니다.');
    await seekTo(video, operation.sourceStart);
    if (cancelRequested) throw new Error(EDIT_CANCEL_MESSAGE);

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('영상 처리용 캔버스를 만들지 못했습니다.');

    canvasStream = canvas.captureStream(FRAME_RATE);
    const streamTracks = [...canvasStream.getVideoTracks()];

    try {
      if (!audioContext) audioContext = new AudioContext();
      const sourceNode = audioContext.createMediaElementSource(video);
      const audioDestination = audioContext.createMediaStreamDestination();
      sourceNode.connect(audioDestination);
      await audioContext.resume();
      streamTracks.push(...audioDestination.stream.getAudioTracks());
    } catch (error) {
      // 비디오 편집 자체는 음성 캡처를 지원하지 않는 환경에서도 진행한다.
      console.warn('오디오 트랙을 준비하지 못했습니다.', error);
    }

    const mimeType = getSupportedMimeType();
    mediaStream = new MediaStream(streamTracks);
    const recorderOptions = {
      videoBitsPerSecond: videoBitrate,
      audioBitsPerSecond: AUDIO_BITRATE,
    };
    if (mimeType) recorderOptions.mimeType = mimeType;

    try {
      recorder = new MediaRecorder(mediaStream, recorderOptions);
    } catch (error) {
      throw new Error(`이 브라우저에서는 영상 저장을 지원하지 않습니다. (${error.message})`);
    }

    const chunks = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });

    const stopped = new Promise((resolve, reject) => {
      recorder.addEventListener('stop', resolve, { once: true });
      recorder.addEventListener('error', (event) => {
        reject(event.error || new Error('영상 저장 중 오류가 발생했습니다.'));
      }, { once: true });
    });

    let recordingStopped = false;
    let recordingError = null;
    stopRecording = () => {
      if (recordingStopped || !recorder || recorder.state === 'inactive') return;
      recordingStopped = true;
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      video.pause();
      recorder.stop();
    };

    const sourceLength = operation.sourceEnd - operation.sourceStart;
    const updateProgress = () => {
      const elapsed = Math.max(0, video.currentTime - operation.sourceStart);
      onProgress?.(Math.min(99, (elapsed / sourceLength) * 100));
    };

    const setPlaybackRate = () => {
      const time = video.currentTime;
      const desiredRate = operation.type === 'speed'
        && time >= operation.rangeStart
        && time < operation.rangeEnd
        ? operation.speed
        : 1;
      if (Math.abs(video.playbackRate - desiredRate) > 0.001) {
        video.playbackRate = desiredRate;
      }
    };

    const renderFrame = () => {
      if (cancelRequested || video.currentTime >= operation.sourceEnd - 0.001 || video.ended) {
        stopRecording();
        return;
      }

      setPlaybackRate();
      context.drawImage(video, 0, 0, dimensions.width, dimensions.height);
      updateProgress();
      animationFrame = requestAnimationFrame(renderFrame);
    };

    video.addEventListener('ended', stopRecording, { once: true });
    video.addEventListener('error', () => {
      recordingError = new Error('편집 중 동영상 재생 오류가 발생했습니다.');
      recordingStopped = true;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    }, { once: true });

    onStatus?.('영상을 편집하고 있습니다...');
    onProgress?.(0);
    recorder.start(500);
    setPlaybackRate();
    context.drawImage(video, 0, 0, dimensions.width, dimensions.height);
    await video.play();
    renderFrame();
    await stopped;

    if (recordingError) throw recordingError;
    if (cancelRequested) throw new Error(EDIT_CANCEL_MESSAGE);
    onProgress?.(100);
    return new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' });
  } catch (error) {
    stopRecording();
    if (cancelRequested && error.message !== EDIT_CANCEL_MESSAGE) {
      throw new Error(EDIT_CANCEL_MESSAGE);
    }
    throw error;
  } finally {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    video.pause();
    video.removeAttribute('src');
    URL.revokeObjectURL(objectUrl);
    canvasStream?.getTracks().forEach(track => track.stop());
    mediaStream?.getTracks().forEach(track => track.stop());
    if (ownsAudioContext && audioContext && audioContext.state !== 'closed') {
      await audioContext.close().catch(() => {});
    }
  }
}

function getSupportedMimeType() {
  const mimeTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
  ];
  return mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function waitForEvent(target, eventName, errorMessage) {
  return new Promise((resolve, reject) => {
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(errorMessage));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, onSuccess);
      target.removeEventListener('error', onError);
    };
    target.addEventListener(eventName, onSuccess, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

function seekTo(video, time) {
  if (Math.abs(video.currentTime - time) < 0.02) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('영상의 지정한 위치로 이동하지 못했습니다.'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = time;
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatSeconds(seconds) {
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}
