import { formatNumber, lang, localize, message, setupLanguage, t } from './i18n.js';
import { isModelSelectionLocked, selectModelFile } from './operations.js';
import * as readerProfile from './reader-profile.js';

const { fallbackReader, fastReader, threaded } = readerProfile;

const app = document.querySelector('#app');
const workspace = document.querySelector('#workspace');
const dropArea = document.querySelector('#drop-area');
const input = document.querySelector('#file-input');
const openButton = document.querySelector('#open-file');
const replaceButton = document.querySelector('#replace-file');
const cancelButton = document.querySelector('#cancel');
const status = document.querySelector('#status');
const openingProgress = document.querySelector('#open-progress');
const openingMeter = document.querySelector('#open-meter');
const percentLabel = document.querySelector('#open-percent');
const elapsedLabel = document.querySelector('#open-elapsed');
const modelBar = document.querySelector('#model-bar');
const modelName = document.querySelector('#model-name');
let viewer = document.querySelector('#viewer');
const readerStartupTimeout = 60_000;
const fastOpenIdleTimeout = 25_000;
const fastReaderMaxBytes = 50 * 1024 * 1024;
const fastReaderSupported = fastReader && navigator.deviceMemory >= 8 && navigator.hardwareConcurrency >= 5;
const useViewerIsolation = threaded || fastReaderSupported;

function canUseFastReader(file) {
  return fastReaderSupported && /\.rvt$/i.test(file.name) && file.size <= fastReaderMaxBytes &&
    crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';
}

let opening;
let pendingFile;
let displayedScratch;
let displayedFiles;
let elapsedTimer;
let modelUrl;
let dragDepth = 0;
let statusText;
let readerPath = './reader.js';
let stopIsolationReload;

if (useViewerIsolation && !crossOriginIsolated && navigator.serviceWorker && !navigator.serviceWorker.controller) {
  const reload = () => location.reload();
  stopIsolationReload = () => navigator.serviceWorker.removeEventListener('controllerchange', reload);
  navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
  navigator.serviceWorker.register(new URL('../../thread-isolation.js', import.meta.url)).catch(error => {
    stopIsolationReload();
    console.warn('Could not enable viewer isolation.', error);
  });
}

function showStatus(text, error = false) {
  statusText = typeof text === 'function' ? text : () => localize(text);
  status.textContent = statusText();
  status.toggleAttribute('data-error', error);
}

function startOpeningProgress() {
  const started = performance.now();
  const updateElapsed = () => {
    const seconds = Math.floor((performance.now() - started) / 1000);
    elapsedLabel.textContent = t('elapsed', { elapsed: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` });
  };

  updateElapsed();
  openingMeter.value = 0;
  percentLabel.textContent = '≈ 0%';
  openingProgress.hidden = false;
  elapsedTimer = setInterval(updateElapsed, 1000);
  opening.updateElapsed = updateElapsed;
}

function finish(open) {
  if (opening !== open) return;
  opening = undefined;
  updateOpenButtons();
  cancelButton.hidden = true;
  clearInterval(elapsedTimer);
  openingProgress.hidden = true;
  syncViewerLanguage();
}

function updateOpenButtons() {
  openButton.disabled = replaceButton.disabled = Boolean(opening) || isModelSelectionLocked();
}

function showProgress(open, { percent, key, completed, total, level, label }) {
  if (opening !== open) return;
  openingMeter.value = Math.max(openingMeter.value, percent);
  percentLabel.textContent = `≈ ${openingMeter.value}%`;
  showStatus(() => {
    const options = { maximumFractionDigits: 1 };
    const values = {
      completed: formatNumber(completed ?? 0, options),
      total: formatNumber(total ?? 0, options),
      level: formatNumber(level ?? 0),
    };
    const withCount = total > 0 && ['view.decodeFound', 'view.wallGeometry', 'view.decodeGeometry'].includes(key);
    return [open.recovering && t('view.fallback'), key ? t(key, values) : label,
      withCount && t('count', values), open.file.name].filter(Boolean).join(' · ');
  });
}

async function removeScratch(name) {
  try {
    const directory = await navigator.storage.getDirectory();
    for (;;) {
      try {
        await directory.removeEntry(name, { recursive: true });
        return;
      } catch (error) {
        if (error.name === 'NotFoundError') return;
        // Terminating the worker and releasing its sync file handle are asynchronous.
        if (error.name !== 'NoModificationAllowedError') throw error;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
  } catch (error) {
    console.warn('Не удалось удалить временные данные модели.', error);
  }
}

function holdScratchLease(name) {
  if (!navigator.locks) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    navigator.locks.request(name, () => new Promise(release => resolve(release))).catch(reject);
  });
}

async function disposeScratch(scratch) {
  if (!scratch) return;
  try { await removeScratch(scratch.name); }
  finally { scratch.release?.(); }
}

async function cleanAbandonedScratch() {
  if (!navigator.locks || !navigator.storage?.getDirectory) return;
  try {
    const directory = await navigator.storage.getDirectory();
    for await (const name of directory.keys()) {
      if (!/^ioviewer-open-[a-f0-9-]{36}\.tmp$/.test(name)) continue;
      await navigator.locks.request(name, { ifAvailable: true }, lease => lease && removeScratch(name));
    }
  } catch (error) {
    if (!['SecurityError', 'NotAllowedError', 'NotSupportedError'].includes(error.name))
      console.warn('Не удалось очистить временные данные модели.', error);
  }
}

function runWorker(open, path, data, startupTimeout, idleTimeout) {
  const { signal } = open.controller;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const failed = (error = new Error()) => Object.assign(error, {
      localized: message('workerFailed'), retryable: true,
    });
    let worker;
    try { worker = new Worker(new URL(path, import.meta.url), { type: 'module' }); }
    catch (error) { reject(failed(error)); return; }
    function settle(callback, value) {
      clearTimeout(startup);
      clearTimeout(inactivity);
      signal.removeEventListener('abort', abort);
      worker.onmessage = worker.onmessageerror = worker.onerror = null;
      worker.terminate();
      callback(value);
    }
    const abort = () => settle(reject, signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = worker.onmessageerror = event => {
      event.preventDefault();
      settle(reject, failed());
    };
    let lastProgress;
    worker.onmessage = ({ data: result }) => {
      const progress = result?.progress;
      if (progress) {
        if (progress.key === 'view.check') clearTimeout(startup);
        if (idleTimeout && (!lastProgress || progress.percent > lastProgress.percent ||
            (progress.percent === lastProgress.percent && progress.key === lastProgress.key &&
              progress.completed > (lastProgress.completed ?? 0)))) {
          lastProgress = progress;
          clearTimeout(inactivity);
          inactivity = setTimeout(timedOut, idleTimeout);
        }
        showProgress(open, progress);
        return;
      }
      if (result?.error || result?.localized)
        settle(reject, Object.assign(new Error(result.error), {
          localized: result.localized, retryable: result.retryable,
        }));
      else if (result?.html || result?.triangles || result?.files) settle(resolve, result);
    };
    const timedOut = () => settle(reject, failed());
    const startup = startupTimeout && setTimeout(timedOut, startupTimeout);
    let inactivity = idleTimeout && setTimeout(timedOut, idleTimeout);
    try { worker.postMessage(data); }
    catch (error) { settle(reject, error); }
  });
}

async function prepareScratch(open) {
  if (!/\.rvt$/i.test(open.file.name) || !globalThis.crypto?.randomUUID || !navigator.storage?.getDirectory) return;
  const name = `ioviewer-open-${crypto.randomUUID()}.tmp`;
  open.scratch = { name };
  try {
    open.scratch.release = await holdScratchLease(name);
    const directory = await navigator.storage.getDirectory();
    open.controller.signal.throwIfAborted();
    return await directory.getDirectoryHandle(name, { create: true });
  } catch (error) {
    if (!['SecurityError', 'NotAllowedError', 'NotSupportedError'].includes(error.name)) throw error;
  }
}

function setViewerSource(frame, source) {
  const url = new URL(source);
  url.hash = new URLSearchParams({ ioextendLang: lang });
  frame.dataset.locale = lang;
  frame.src = url;
}

const pagedViewerUrl = new URL('./paged-viewer.html', import.meta.url);

function syncViewerLanguage() {
  if (opening || workspace.hidden || viewer.hidden || viewer.dataset.locale === lang) return;
  const frame = viewer.cloneNode(false);
  setViewerSource(frame, modelUrl ?? pagedViewerUrl);
  viewer.replaceWith(frame);
  viewer = frame;
}

function stageFrame(open, files, deadline) {
  const { signal } = open.controller;
  signal.throwIfAborted();
  const frame = viewer.cloneNode(false);
  frame.removeAttribute('id');
  frame.hidden = false;
  frame.inert = true;
  frame.classList.add('viewer-loading');
  setViewerSource(frame, open.url ?? pagedViewerUrl);
  open.frame = frame;
  return new Promise((resolve, reject) => {
    function settle(callback, value) {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      frame.onerror = null;
      window.removeEventListener('message', receive);
      callback(value);
    }
    const abort = () => settle(reject, signal.reason);
    function receive(event) {
      if (event.source !== frame.contentWindow || event.origin !== 'null') return;
      switch (event.data?.type) {
        case 'ioviewer-page-request':
          if (files) frame.contentWindow.postMessage({ type: 'ioviewer-pages', files }, '*');
          break;
        case 'ioviewer-page-ready':
          settle(resolve, frame);
          break;
        case 'ioviewer-page-error':
          settle(reject, new Error(event.data.error));
          break;
      }
    }
    signal.addEventListener('abort', abort, { once: true });
    const failed = detail => settle(reject, Object.assign(new Error(detail), { localized: message('view.pageFailed') }));
    frame.onerror = () => failed('Viewer iframe failed to load.');
    const timer = deadline && setTimeout(() => failed('Viewer iframe did not report readiness.'), deadline);
    window.addEventListener('message', receive);
    viewer.after(frame);
  });
}

function selectViewerFile(file) {
  if (!(file instanceof File) || opening || isModelSelectionLocked()) return;
  if (!/\.(rvt|nwc)$/i.test(file.name)) {
    showStatus(message('chooseRvtNwc'), true);
    return;
  }

  if (file.size === 0) {
    showStatus(message('emptyFile'), true);
    return;
  }
  selectModelFile(file);
}

async function openFile(file) {
  const started = performance.now();
  const canPreview = /\.(rvt|nwc)$/i.test(file.name);
  if (!canPreview) {
    viewer.hidden = modelBar.hidden = true;
    dropArea.hidden = false;
    viewer.removeAttribute('src');
    if (modelUrl) URL.revokeObjectURL(modelUrl);
    disposeScratch(displayedScratch);
    modelUrl = displayedScratch = displayedFiles = undefined;
    showStatus(() => `${file.name} · ${t('chooseRvtNwc')}`);
    return;
  }
  if (threaded && (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined')) {
    if (!fallbackReader) {
      showStatus(message('workerFailed'), true);
      return;
    }
    readerPath = fallbackReader;
  }
  const open = { file, controller: new AbortController() };
  opening = open;
  showStatus(message('loadKernel'));
  updateOpenButtons();
  cancelButton.hidden = false;
  startOpeningProgress();

  try {
    let scratchDirectory, result, frame;
    if (canUseFastReader(file)) {
      try {
        const fastResult = await runWorker(open, fastReader, { file }, readerStartupTimeout, fastOpenIdleTimeout);
        if (!fastResult.html || fastResult.errors) throw new Error('Fast reader did not produce a complete view.');
        open.url = URL.createObjectURL(fastResult.html);
        frame = await stageFrame(open, undefined, fastOpenIdleTimeout);
        result = fastResult;
      } catch (error) {
        open.controller.signal.throwIfAborted();
        open.frame?.remove();
        if (open.url) URL.revokeObjectURL(open.url);
        open.frame = open.url = undefined;
        console.debug('IOExtend fast reader fallback', error.message || error.localized);
        openingMeter.value = 0;
        showProgress(open, { percent: 0, key: 'loadKernel' });
      }
    }
    if (!result) {
      scratchDirectory = await prepareScratch(open);
      try {
        result = await runWorker(open, readerPath, { file, scratchDirectory }, readerStartupTimeout);
      } catch (error) {
        open.controller.signal.throwIfAborted();
        if (!fallbackReader || readerPath === fallbackReader || !error.retryable) throw error;
        readerPath = fallbackReader;
        open.recovering = true;
        openingMeter.value = 0;
        showProgress(open, { percent: 0, key: 'loadKernel' });
        await disposeScratch(open.scratch);
        open.scratch = undefined;
        open.controller.signal.throwIfAborted();
        scratchDirectory = await prepareScratch(open);
        result = await runWorker(open, readerPath, { file, scratchDirectory }, readerStartupTimeout);
      }
    }
    let pagesFiles;
    if (result.triangles) {
      showProgress(open, { percent: 97, key: 'view.preparePages', completed: result.triangles });
      const { files, pages, html } = await runWorker(open, './mesh-pages-worker.js', {
        scratchDirectory, triangles: result.triangles,
        inlineViewer: useViewerIsolation && Boolean(navigator.serviceWorker?.controller),
      });
      showProgress(open, { percent: 99, key: 'view.openPages', completed: pages });
      pagesFiles = files;
      if (html) open.url = URL.createObjectURL(html);
    } else if (!frame) {
      open.url = URL.createObjectURL(result.html);
    }
    frame ??= await stageFrame(open, pagesFiles);
    open.controller.signal.throwIfAborted();

    const oldScratch = displayedScratch;
    const oldUrl = modelUrl;
    viewer.remove();
    viewer = frame;
    viewer.id = 'viewer';
    viewer.classList.remove('viewer-loading');
    viewer.inert = false;
    displayedScratch = pagesFiles ? open.scratch : undefined;
    if (pagesFiles) open.scratch = undefined;
    displayedFiles = pagesFiles;
    open.frame = undefined;
    modelUrl = open.url;
    open.url = undefined;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    disposeScratch(oldScratch);
    viewer.hidden = modelBar.hidden = false;
    dropArea.hidden = true;
    modelName.textContent = file.name;
    performance.measure('ioextend:first-frame', { start: started });

    if (result.errors) showStatus(message('view.readErrors'), true);
    else if (result.warnings) showStatus(message('view.readWarnings'));
    else showStatus('');
  } catch (error) {
    if (!open.controller.signal.aborted)
      showStatus(() => t('view.failed', { detail: localize(error.localized ?? error.message) }), true);
  } finally {
    open.frame?.remove();
    if (open.url) URL.revokeObjectURL(open.url);
    disposeScratch(open.scratch);
    finish(open);
  }
}

for (const button of [openButton, replaceButton]) {
  button.addEventListener('click', () => {
    stopIsolationReload?.();
    input.click();
  });
}

input.addEventListener('change', () => {
  selectViewerFile(input.files[0]);
  input.value = '';
});

cancelButton.addEventListener('click', () => {
  if (!opening) return;
  const open = opening;
  open.controller.abort();
  finish(open);
  showStatus(message('view.canceled'));
  (viewer.hidden ? openButton : replaceButton).focus();
});

function openDrop(files) {
  if (workspace.hidden || opening || isModelSelectionLocked()) return;
  if (files.length > 1) showStatus(message('oneViewerFile'), true);
  else selectViewerFile(files[0]);
}

window.addEventListener('message', event => {
  if (event.source !== viewer.contentWindow || event.origin !== 'null') return;
  if (event.data?.type === 'ioviewer-drop' && Array.isArray(event.data.files)) openDrop(event.data.files);
  else if (event.data?.type === 'ioviewer-page-request' && displayedFiles)
    viewer.contentWindow.postMessage({ type: 'ioviewer-pages', files: displayedFiles }, '*');
});

window.addEventListener('dragenter', event => {
  if (app.dataset.mode !== 'view' || !event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  dragDepth++;
  if (!opening && !isModelSelectionLocked()) workspace.classList.add('dragging');
});

window.addEventListener('dragleave', () => {
  if (dragDepth > 0 && --dragDepth === 0) workspace.classList.remove('dragging');
});

window.addEventListener('dragover', event => {
  if (app.dataset.mode !== 'view' || !event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = opening || isModelSelectionLocked() ? 'none' : 'copy';
});

window.addEventListener('drop', event => {
  if (app.dataset.mode !== 'view' || !event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  dragDepth = 0;
  workspace.classList.remove('dragging');
  openDrop(event.dataTransfer.files);
});

window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  opening?.controller.abort();
  disposeScratch(displayedScratch);
});

document.addEventListener('localechange', () => {
  if (statusText) status.textContent = statusText();
  opening?.updateElapsed?.();
  syncViewerLanguage();
});
function openPendingFile() {
  if (workspace.hidden) return;
  if (!pendingFile) {
    syncViewerLanguage();
    return;
  }
  const file = pendingFile;
  pendingFile = undefined;
  openFile(file);
}

document.addEventListener('model-file-selected', ({ detail: file }) => {
  stopIsolationReload?.();
  if (opening) {
    opening.controller.abort();
    finish(opening);
  }
  pendingFile = file;
  openPendingFile();
});
document.addEventListener('view-activated', openPendingFile);
document.addEventListener('operation-statechange', updateOpenButtons);
setupLanguage();
cleanAbandonedScratch();
