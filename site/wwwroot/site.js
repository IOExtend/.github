import { formatNumber, lang, localize, message, setupLanguage, t } from './i18n.js';
import { threaded } from './reader-profile.js';

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

let opening;
let displayedScratch;
let displayedFiles;
let elapsedTimer;
let modelUrl;
let dragDepth = 0;
let statusText;

if (threaded && !crossOriginIsolated && navigator.serviceWorker && !navigator.serviceWorker.controller) {
  // Wait for the first controlled navigation before accepting a local file.
  openButton.disabled = true;
  const reload = () => location.reload();
  navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
  navigator.serviceWorker.register(new URL('../../thread-isolation.js', import.meta.url)).catch(error => {
    navigator.serviceWorker.removeEventListener('controllerchange', reload);
    console.error(error);
    showStatus(message('workerFailed'), true);
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
  openButton.disabled = replaceButton.disabled = false;
  cancelButton.hidden = true;
  clearInterval(elapsedTimer);
  openingProgress.hidden = true;
  syncViewerLanguage();
}

function showProgress(open, { percent, key, completed, total, level, label }) {
  if (opening !== open) return;
  openingMeter.value = Math.max(openingMeter.value, percent);
  percentLabel.textContent = `≈ ${openingMeter.value}%`;
  showStatus(() => {
    if (!key) return `${label} · ${open.file.name}`;
    const options = { maximumFractionDigits: 1 };
    const values = {
      completed: formatNumber(completed ?? 0, options),
      total: formatNumber(total ?? 0, options),
      level: formatNumber(level ?? 0),
    };
    const withCount = total > 0 && ['view.decodeFound', 'view.wallGeometry', 'view.decodeGeometry'].includes(key);
    return [t(key, values), withCount ? t('count', values) : '', open.file.name].filter(Boolean).join(' · ');
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

function runWorker(open, path, data) {
  const { signal } = open.controller;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(path, import.meta.url), { type: 'module' });
    function settle(callback, value) {
      signal.removeEventListener('abort', abort);
      worker.onmessage = worker.onerror = null;
      worker.terminate();
      callback(value);
    }
    const abort = () => settle(reject, signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => settle(reject, Object.assign(new Error(), { localized: message('workerFailed') }));
    worker.onmessage = ({ data: result }) => {
      if (result?.progress) {
        showProgress(open, result.progress);
        return;
      }
      if (result?.error || result?.localized)
        settle(reject, Object.assign(new Error(result.error), { localized: result.localized }));
      else if (result?.html || result?.triangles || result?.files) settle(resolve, result);
    };
    try { worker.postMessage(data); }
    catch (error) { settle(reject, error); }
  });
}

function setViewerSource(frame, source) {
  const url = new URL(source);
  url.hash = new URLSearchParams({ ioextendLang: lang });
  frame.dataset.locale = lang;
  frame.src = url;
}

const pagedViewerUrl = new URL('./paged-viewer.html', import.meta.url);

function syncViewerLanguage() {
  if (opening || viewer.hidden || viewer.dataset.locale === lang) return;
  const frame = viewer.cloneNode(false);
  setViewerSource(frame, modelUrl ?? pagedViewerUrl);
  viewer.replaceWith(frame);
  viewer = frame;
}

function stagePagedFrame(open, files) {
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
          frame.contentWindow.postMessage({ type: 'ioviewer-pages', files }, '*');
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
    frame.onerror = () => settle(reject, Object.assign(new Error(), { localized: message('view.pageFailed') }));
    window.addEventListener('message', receive);
    viewer.after(frame);
  });
}

async function openFile(file) {
  if (!(file instanceof File) || opening) return;
  if (threaded && !crossOriginIsolated) {
    showStatus(message('workerFailed'), true);
    return;
  }
  if (!/\.(rvt|nwc)$/i.test(file.name)) {
    showStatus(message('chooseRvtNwc'), true);
    return;
  }

  if (file.size === 0) {
    showStatus(message('emptyFile'), true);
    return;
  }

  document.dispatchEvent(new CustomEvent('viewer-model-selected', { detail: file }));
  const open = { file, controller: new AbortController() };
  opening = open;
  showStatus(message('loadKernel'));
  openButton.disabled = replaceButton.disabled = true;
  cancelButton.hidden = false;
  startOpeningProgress();

  try {
    let scratchDirectory;
    if (/\.rvt$/i.test(file.name) && globalThis.crypto?.randomUUID && navigator.storage?.getDirectory) {
      const name = `ioviewer-open-${crypto.randomUUID()}.tmp`;
      open.scratch = { name };
      try {
        open.scratch.release = await holdScratchLease(name);
        const directory = await navigator.storage.getDirectory();
        open.controller.signal.throwIfAborted();
        scratchDirectory = await directory.getDirectoryHandle(name, { create: true });
      } catch (error) {
        if (!['SecurityError', 'NotAllowedError', 'NotSupportedError'].includes(error.name)) throw error;
      }
    }
    const result = await runWorker(open, './reader.js', { file, scratchDirectory });
    let frame, pagesFiles;
    if (result.triangles) {
      showProgress(open, { percent: 97, key: 'view.preparePages', completed: result.triangles });
      const { files, pages, html } = await runWorker(open, './mesh-pages-worker.js', {
        scratchDirectory, triangles: result.triangles,
        inlineViewer: threaded && Boolean(navigator.serviceWorker?.controller),
      });
      showProgress(open, { percent: 99, key: 'view.openPages', completed: pages });
      pagesFiles = files;
      if (html) open.url = URL.createObjectURL(html);
      frame = await stagePagedFrame(open, files);
    }
    open.controller.signal.throwIfAborted();

    const oldScratch = displayedScratch;
    const oldUrl = modelUrl;
    if (frame) {
      viewer.remove();
      viewer = frame;
      viewer.id = 'viewer';
      viewer.classList.remove('viewer-loading');
      viewer.inert = false;
      displayedScratch = open.scratch;
      displayedFiles = pagesFiles;
      open.scratch = undefined;
      open.frame = undefined;
      modelUrl = open.url;
      open.url = undefined;
    } else {
      modelUrl = URL.createObjectURL(result.html);
      setViewerSource(viewer, modelUrl);
      displayedScratch = undefined;
      displayedFiles = undefined;
    }
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    disposeScratch(oldScratch);
    viewer.hidden = modelBar.hidden = false;
    dropArea.hidden = true;
    modelName.textContent = file.name;

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
  button.addEventListener('click', () => input.click());
}

input.addEventListener('change', () => {
  openFile(input.files[0]);
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
  if (workspace.hidden || opening) return;
  if (files.length > 1) showStatus(message('oneViewerFile'), true);
  else openFile(files[0]);
}

window.addEventListener('message', event => {
  if (event.source !== viewer.contentWindow || event.origin !== 'null') return;
  if (event.data?.type === 'ioviewer-drop' && Array.isArray(event.data.files)) openDrop(event.data.files);
  else if (event.data?.type === 'ioviewer-page-request' && displayedFiles)
    viewer.contentWindow.postMessage({ type: 'ioviewer-pages', files: displayedFiles }, '*');
});

window.addEventListener('dragenter', event => {
  if (workspace.hidden || !event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  dragDepth++;
  workspace.classList.add('dragging');
});

window.addEventListener('dragleave', () => {
  if (dragDepth > 0 && --dragDepth === 0) workspace.classList.remove('dragging');
});

window.addEventListener('dragover', event => {
  if (workspace.hidden || !event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = opening ? 'none' : 'copy';
});

window.addEventListener('drop', event => {
  if (workspace.hidden || !event.dataTransfer.types.includes('Files')) return;
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
setupLanguage();
cleanAbandonedScratch();
