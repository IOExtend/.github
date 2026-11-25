import { exportFormats, extensionOf } from './formats.js';
import { targetReleases } from './revit-versions.js';
import { formatNumber, hasTranslation, localize, message, t } from './i18n.js';

const byId = id => document.getElementById(id);
const workspace = byId('workspace');
const panel = byId('operations');
const drop = byId('operation-drop');
const input = byId('operation-input');
const targetVersion = byId('target-version');
const sourceVersion = byId('source-version');
const chooseFile = byId('choose-operation');
const submit = byId('run-operation');
const cancel = byId('cancel-operation');
const status = byId('operation-status');
const progress = byId('operation-progress');
const phaseLabel = byId('operation-phase');
const stageMeter = byId('operation-meter');
const batch = byId('operation-batch');
const batchMeter = byId('operation-batch-meter');
const phaseUnits = {
  partitions: 'streams', 'r22-layout': 'streams', 'element-records': 'blocks', 'element-blocks': 'passes',
  'parameter-stream': 'bytes', 'recover-geometry': 'passes', 'geometry-blocks': 'blocks',
  'element-properties': 'blocks', 'build-model': 'records', 'finalize-model': 'passes', meshes: 'elements',
};
const downgradePhases = ['runtime', 'metadata', 'profile', 'plan', 'rewrite', 'write', 'verify', 'report', 'download'];
const downloads = byId('operation-downloads');
const allFormats = byId('select-formats');
const optional = byId('optional-formats');
const tabs = [...document.querySelectorAll('.tools-nav a')];
const modes = {
  export: {
    accept: '.rvt,.rfa,.nwc,.nwd',
  },
  downgrade: {
    accept: '.rvt,.rfa',
  },
};
const states = Object.fromEntries(Object.keys(modes).map(mode =>
  [mode, { selected: new Set(), results: [], message: '', error: false }]));
let mode, task;

function formatOption(state, format) {
  const label = document.createElement('label');
  label.className = 'format-option';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.value = format.id;
  checkbox.checked = state.selected.has(format.id);
  checkbox.disabled = Boolean(task);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) state.selected.add(format.id);
    else state.selected.delete(format.id);
    updateControls(state);
  });
  const text = document.createElement('span');
  text.textContent = format.title;
  const suffix = document.createElement('small');
  suffix.textContent = format.suffix;
  text.append(suffix);
  label.append(checkbox, text);
  return label;
}

function renderFormats(state) {
  const formats = state.file ? exportFormats(state.file.name) : [];
  const primary = formats.filter(format => !format.optional);
  const additional = formats.filter(format => format.optional);
  byId('formats-empty').hidden = formats.length > 0;
  allFormats.hidden = !primary.length;
  optional.hidden = !additional.length;
  byId('format-list').replaceChildren(...primary.map(format => formatOption(state, format)));
  byId('optional-format-list').replaceChildren(...additional.map(format => formatOption(state, format)));
}

function downloadLink(file, url, label) {
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.textContent = label;
  link.setAttribute('aria-label', `${label} ${file.name}`);
  return link;
}

function renderResults(state) {
  byId('operation-results').hidden = !state.results.length;
  downloads.replaceChildren(...state.results.map(result => {
    const item = document.createElement('li');
    item.className = 'operation-result';
    const title = document.createElement('p');
    title.textContent = result.file?.name ?? t(result.title);
    item.append(title);
    if (result.file) item.append(downloadLink(result.file, result.url, t('save')));
    if (result.error) {
      const error = document.createElement('p');
      error.textContent = localize(result.error);
      error.setAttribute('data-error', '');
      item.append(error);
    }
    if (result.diagnostics || result.report) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = t('diagnostics');
      const diagnostics = document.createElement('pre');
      diagnostics.textContent = result.diagnostics;
      details.append(summary);
      if (result.diagnostics) details.append(diagnostics);
      if (result.report) details.append(downloadLink(result.report, result.reportUrl, t('saveReport')));
      item.append(details);
    }
    return item;
  }));
}

function clearResults(state) {
  for (const result of state.results) {
    if (result.url) URL.revokeObjectURL(result.url);
    if (result.reportUrl) URL.revokeObjectURL(result.reportUrl);
  }
  state.results = [];
}

function updateControls(state) {
  const running = Boolean(task);
  chooseFile.disabled = allFormats.disabled = running;
  targetVersion.disabled = running || mode !== 'downgrade' || !targetReleases(state.version).length;
  drop.classList.toggle('busy', running);
  for (const checkbox of panel.querySelectorAll('input[type=checkbox]')) checkbox.disabled = running;
  submit.disabled = running || !state.file ||
    (mode === 'export' ? !state.selected.size : !state.target);
  cancel.hidden = task?.mode !== mode || !running;
}

function showStatus(state, message, error = false) {
  state.message = message;
  state.error = error;
  if (states[mode] !== state) return;
  status.textContent = localize(message);
  status.toggleAttribute('data-error', error);
}

function showFiles(state) {
  byId('operation-file').textContent = state.file?.name ?? t('dropHere');
  byId('operation-accept').textContent = state.file
    ? fileSize(state.file.size)
    : modes[mode].accept.replaceAll('.', '').toUpperCase().split(',').join(', ');
  chooseFile.textContent = t(state.file ? 'chooseAnother' : 'chooseFile');
}

function showVersions(state) {
  const versions = targetReleases(state.version);
  targetVersion.replaceChildren(new Option(t('chooseVersion'), ''),
    ...versions.map(year => new Option(`Revit ${year}`, year)));
  targetVersion.value = state.target || '';
  sourceVersion.textContent = state.versionError ? t('versionError') : state.probe ? t('versionProbe')
    : state.version ? t(versions.length ? 'detectedVersion' : 'noEarlierVersion', { year: state.version })
      : t('chooseSourceRvt');
  sourceVersion.toggleAttribute('data-error', Boolean(state.versionError));
}

async function inspectVersion(state) {
  if (!state.file || state.probe || state.version || state.versionError) return;
  const controller = new AbortController();
  state.probe = controller;
  showVersions(state);
  try {
    const result = await runWorker({ mode: 'downgrade', signal: controller.signal },
      { file: state.file, format: 'revit-version' });
    if (state.probe === controller) state.version = result.version;
  } catch {
    if (state.probe === controller) state.versionError = true;
  } finally {
    if (state.probe === controller) {
      state.probe = undefined;
      if (mode === 'downgrade') {
        showVersions(state);
        updateControls(state);
      }
    }
  }
}

function fileSize(size) {
  const [unit, factor] = size >= 1_000_000_000 ? ['gigabyte', 1_000_000_000]
    : size >= 1_000_000 ? ['megabyte', 1_000_000] : size >= 1000 ? ['kilobyte', 1000] : ['byte', 1];
  return formatNumber(size / factor, { style: 'unit', unit, maximumFractionDigits: 2 });
}

function elapsed(start, now) {
  const seconds = Math.floor((now - start) / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function renderClock(job) {
  if (progress.hidden || mode !== job.mode) return;
  const now = performance.now();
  byId('operation-elapsed').textContent = t('operationTime', {
    elapsed: elapsed(job.started, now), stageTime: elapsed(job.stageStarted, now),
  });
}

function renderProgress() {
  progress.hidden = !task || mode !== task.mode;
  if (progress.hidden) return;
  const { phase, completed, total, bytesRead, bytesWritten } = task.progress;
  const unit = phaseUnits[phase];
  const key = `phase.${phase}`;
  const title = `${t(hasTranslation(key) ? key : 'phase.decode')} · ${task.label()}`;
  if (phaseLabel.textContent !== title) phaseLabel.textContent = title;
  if (total > 0) {
    stageMeter.max = total;
    stageMeter.value = completed;
    const display = unit === 'bytes' ? fileSize : formatNumber;
    const count = t('count', { completed: display(completed), total: display(total) });
    byId('operation-count').textContent =
      t('stagePercent', { percent: Math.floor(100 * stageMeter.position), count }) +
      (unit && unit !== 'bytes' ? ` · ${t(`unit.${unit}`)}` : '');
  } else {
    stageMeter.removeAttribute('value');
    const step = task.mode === 'downgrade' ? downgradePhases.indexOf(phase) + 1 : 0;
    byId('operation-count').textContent = step ? t('step', { step, total: downgradePhases.length }) : '';
  }
  byId('operation-io').textContent = [
    bytesRead ? t('readBytes', { size: fileSize(bytesRead) }) : '',
    bytesWritten ? t('writtenBytes', { size: fileSize(bytesWritten) }) : '',
  ].filter(Boolean).join(' · ');
  batch.hidden = task.total === 1;
  if (!batch.hidden) {
    batchMeter.max = task.total;
    batchMeter.value = task.index;
    byId('operation-batch-label').textContent = t('batchCount', { done: task.index, total: task.total });
  }
  renderClock(task);
}

function route() {
  const requested = location.hash.slice(1);
  mode = Object.hasOwn(modes, requested) ? requested : 'view';
  for (const tab of tabs) {
    if (tab.hash === '#' + mode) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  workspace.hidden = mode !== 'view';
  panel.hidden = mode === 'view';
  workspace.classList.remove('dragging');
  if (panel.hidden) return;
  const settings = modes[mode];
  const state = states[mode];
  byId('operation-title').textContent = t(`${mode}Title`);
  byId('operation-description').textContent = t(`${mode}Description`);
  byId('export-settings').hidden = mode !== 'export';
  byId('downgrade-settings').hidden = mode !== 'downgrade';
  input.accept = settings.accept;
  submit.textContent = t(`${mode}Action`);
  showFiles(state);
  if (mode === 'downgrade') {
    showVersions(state);
    inspectVersion(state);
  }
  renderFormats(states.export);
  renderResults(state);
  showStatus(state, state.message, state.error);
  updateControls(state);
  renderProgress();
}

function selectFile(file) {
  const state = states[mode];
  if (!state || !file || task) return;
  const allowed = modes[mode].accept.split(',').includes(extensionOf(file.name));
  if (!allowed || !file.size) {
    showStatus(state, message(!file.size ? 'emptyFile' : 'badFormat'), true);
    return;
  }
  state.probe?.abort();
  state.probe = state.version = state.versionError = state.target = undefined;
  state.file = file;
  state.selected.clear();
  clearResults(state);
  route();
  showStatus(state, '');
}

function runWorker(job, data, onProgress) {
  job.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const entry = job.mode === 'downgrade' ? './downgrade-worker.js' : './export-worker.js';
    const worker = new Worker(new URL(entry, import.meta.url), { type: 'module' });
    function finish(callback, value) {
      job.signal.removeEventListener('abort', abort);
      worker.terminate();
      callback(value);
    }
    const abort = () => finish(reject, job.signal.reason);
    job.signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(reject, Object.assign(new Error(), { localized: message('workerFailed') }));
    worker.onmessageerror = () => finish(reject, Object.assign(new Error(), { localized: message('workerResult') }));
    worker.onmessage = ({ data: result }) => {
      if (result.progress) onProgress?.(result.progress);
      else if (result.error || result.localized) {
        const error = new Error(result.error);
        error.localized = result.localized;
        error.diagnostics = result.diagnostics;
        finish(reject, error);
      }
      else finish(resolve, result);
    };
    try { worker.postMessage(data); }
    catch (error) { finish(reject, error); }
  });
}

async function start(event) {
  event.preventDefault();
  if (submit.disabled) return;
  const state = states[mode];
  const job = { mode, controller: new AbortController() };
  job.signal = job.controller.signal;
  task = job;
  const formats = mode === 'downgrade' ? [{ id: 'downgrade', titleKey: 'revitCopy' }]
    : exportFormats(state.file.name).filter(format => state.selected.has(format.id));
  job.started = performance.now();
  job.total = formats.length;
  clearResults(state);
  renderResults(state);
  showStatus(state, '');
  updateControls(state);
  const timer = setInterval(() => renderClock(job), 1000);
  try {
    for (const [index, format] of formats.entries()) {
      job.index = index;
      job.label = () => job.mode === 'downgrade' ? `Revit ${state.version} → ${state.target}` : format.title;
      job.progress = undefined;
      const reportProgress = update => {
        if (update.phase !== job.progress?.phase) job.stageStarted = performance.now();
        job.progress = update;
        renderProgress();
      };
      reportProgress({ phase: 'prepare' });
      try {
        const result = await runWorker(job, { file: state.file, format: format.id, target: state.target }, reportProgress);
        state.results.push({ ...result, url: URL.createObjectURL(result.file),
          reportUrl: result.report ? URL.createObjectURL(result.report) : undefined });
      } catch (error) {
        if (job.signal.aborted) throw error;
        state.results.push({ title: format.titleKey, error: error.localized ?? error.message, diagnostics: error.diagnostics });
      }
      if (mode === job.mode) renderResults(state);
    }
    const completed = state.results.filter(result => result.file).length;
    showStatus(state, completed === formats.length ? message('done')
      : completed ? message('partlyDone', { done: completed, total: formats.length }) : message('failed'), !completed);
  } catch (error) {
    showStatus(state, job.signal.aborted ? message('operationCanceled') : error.localized ?? error.message, !job.signal.aborted);
  } finally {
    clearInterval(timer);
    task = undefined;
    renderProgress();
    if (!panel.hidden) updateControls(states[mode]);
  }
}

chooseFile.addEventListener('click', () => input.click());
input.addEventListener('change', () => { selectFile(input.files[0]); input.value = ''; });
targetVersion.addEventListener('change', () => {
  const state = states.downgrade;
  state.target = Number(targetVersion.value);
  updateControls(state);
});
byId('operation-form').addEventListener('submit', start);
cancel.addEventListener('click', () => task?.controller.abort());
allFormats.addEventListener('click', () => {
  const state = states.export;
  for (const format of exportFormats(state.file.name).filter(format => !format.optional)) state.selected.add(format.id);
  renderFormats(state);
  updateControls(state);
});
document.addEventListener('viewer-model-selected', ({ detail: file }) => {
  for (const [name, state] of Object.entries(states)) {
    if (!state.file && !task && modes[name].accept.split(',').includes(extensionOf(file.name))) state.file = file;
  }
});
for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
  window.addEventListener(type, event => {
    if (panel.hidden || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    if (type === 'dragover') event.dataTransfer.dropEffect = task ? 'none' : 'copy';
    drop.classList.toggle('dragging', !task && (type === 'dragenter' || type === 'dragover'));
    if (type !== 'drop' || task) return;
    if (event.dataTransfer.files.length === 1) selectFile(event.dataTransfer.files[0]);
    else showStatus(states[mode], message('oneFile'), true);
  });
}
window.addEventListener('hashchange', route);
document.addEventListener('localechange', route);
route();
