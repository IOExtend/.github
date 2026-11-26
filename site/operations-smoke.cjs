const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { basename } = require('node:path');
const { chromium } = require('playwright');

const [url, nwc, rvt, target, downgradeSource = rvt] = process.argv.slice(2);
assert(url && nwc && rvt && /^20\d\d$/.test(target ?? ''),
  'Usage: node operations-smoke.cjs <url> <nwc> <rvt> <target-year> [<downgrade-rvt>]');
const origin = new URL(url).origin;

async function select(page, route, path) {
  await page.goto(url + '#' + route);
  await page.locator(`#app[data-mode="${route}"]`).waitFor();
  await page.locator('#operation-input').setInputFiles(path);
  const file = await page.locator('#operation-file').textContent();
  assert(file.toLowerCase().endsWith(route === 'export' && path === nwc ? '.nwc' : '.rvt'));
}

async function ready(page) {
  const success = page.locator('#operation-status').getByText('Готово. Результаты можно скачать.');
  await success.or(page.locator('#operation-status[data-error]')).waitFor({ timeout: 480_000 });
  assert(await success.isVisible(), await page.locator('#operation-downloads').innerText());
  assert(await page.locator('#operation-progress').isHidden());
  assert(await page.locator('#cancel-operation').isHidden());
}

async function observeProgress(page) {
  await page.evaluate(() => {
    const element = document.getElementById('operation-progress');
    window.operationProgress = { phases: [], counts: [], io: [], batches: [] };
    const record = (key, id) => {
      const value = document.getElementById(id).textContent;
      if (value && window.operationProgress[key].at(-1) !== value)
        window.operationProgress[key].push(value);
    };
    new MutationObserver(() => {
      if (element.hidden) return;
      record('phases', 'operation-phase');
      record('counts', 'operation-count');
      record('io', 'operation-io');
      if (!document.getElementById('operation-batch').hidden)
        record('batches', 'operation-batch-label');
    }).observe(element, { attributes: true, childList: true, subtree: true });
  });
}

async function download(page, selector) {
  const started = page.waitForEvent('download');
  await page.locator(selector).click();
  const file = await started;
  assert.equal(await file.failure(), null);
  return readFile(await file.path());
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.VIEWER_CHROME });
  try {
    const context = await browser.newContext({ acceptDownloads: true, locale: 'ru-RU' });
    const errors = [];
    const outside = [];
    const readerRequests = [];
    context.on('request', request => {
      if (new URL(request.url()).pathname.endsWith('/reader.js')) readerRequests.push(request.url());
    });
    await context.route('**/*', route => {
      const request = route.request();
      if (new URL(request.url()).origin === origin && request.method() === 'GET') return route.continue();
      outside.push(request.method() + ' ' + new URL(request.url()).origin);
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url + '#export');
    await page.locator('#operation-drop').evaluate((target, { name, bytes }) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([Uint8Array.from(atob(bytes), char => char.charCodeAt(0))], name));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    }, { name: basename(nwc), bytes: (await readFile(nwc)).toString('base64') });
    assert.equal(await page.locator('#operation-file').textContent(), basename(nwc));
    assert(await page.locator('#workspace').isHidden());
    await page.getByRole('link', { name: 'Версия Revit' }).click();
    await page.locator('#downgrade-settings').waitFor();
    assert.equal(await page.locator('#operation-file').textContent(), basename(nwc));
    assert(await page.locator('#run-operation').isDisabled());
    assert(await page.locator('#workspace').isHidden());
    assert.deepEqual(readerRequests, []);
    await page.getByRole('link', { name: 'Просмотр' }).click();
    await page.locator('#model-name').getByText(basename(nwc), { exact: true }).waitFor();
    assert(readerRequests.length > 0);
    await page.getByRole('link', { name: 'Экспорт' }).click();
    await page.locator('input[value=glb]').check();
    await page.locator('input[value=json]').check();
    await observeProgress(page);
    await page.getByRole('button', { name: 'Экспортировать' }).click();
    await ready(page);
    const batchProgress = await page.evaluate(() => window.operationProgress);
    assert.deepEqual(batchProgress.batches, ['Завершено форматов 0 из 2', 'Завершено форматов 1 из 2']);
    assert(batchProgress.phases.some(label => label.startsWith('Читаем и разбираем модель')));
    assert(batchProgress.phases.some(label => label.startsWith('Записываем результат')));
    assert(batchProgress.io.some(label => label.includes('Записано')));
    const glb = await download(page, '#operation-downloads a[download$=".glb"]');
    assert.equal(glb.toString('ascii', 0, 4), 'glTF');
    assert.equal(glb.readUInt32LE(8), glb.length);
    const json = await download(page, '#operation-downloads a[download$=".json"]');
    assert(Object.keys(JSON.parse(json)).length);
    console.log('NWC exports both selected formats and downloads valid GLB and JSON.');

    await select(page, 'export', rvt);
    await page.locator('input[value=ifc-parameters]').check();
    await page.getByRole('button', { name: 'Экспортировать' }).click();
    await ready(page);
    const ifc = (await download(page, '#operation-downloads a[download$=".ifc"]')).toString('utf8');
    assert.match(ifc, /^ISO-10303-21;/);
    assert.match(ifc, /IFCPROJECT\(/i);
    assert.match(ifc, /IFCPROPERTYSET\(/i);
    assert.match(ifc, /END-ISO-10303-21;\s*$/);
    console.log('RVT exports and downloads a complete IFC project with property sets.');

    await select(page, 'downgrade', downgradeSource);
    assert(await page.locator('#run-operation').isDisabled());
    const sourceVersion = page.locator('#source-version');
    await sourceVersion.getByText(/Исходный файл · Revit \d{4}/).waitFor();
    const year = Number((await sourceVersion.textContent()).match(/\d{4}/)[0]);
    const choices = await page.locator('#target-version option').evaluateAll(options =>
      options.map(option => Number(option.value)).filter(Boolean));
    assert.deepEqual(choices, [2026, 2025, 2024, 2023, 2022, 2021, 2020].filter(version => version < year));
    await page.getByLabel('Целевая версия Revit').selectOption(target);
    await observeProgress(page);
    await page.getByRole('button', { name: 'Создать копию' }).click();
    await ready(page);
    const downgradeProgress = await page.evaluate(() => window.operationProgress);
    assert.deepEqual(downgradeProgress.counts, Array.from({ length: 9 }, (_, i) => `Этап ${i + 1} из 9`),
      downgradeProgress.phases.join(' → '));
    assert(downgradeProgress.io.some(label => label.includes('Прочитано из исходника')));
    assert(downgradeProgress.io.some(label => label.includes('Записано')));
    const downgraded = await download(page, '#operation-downloads a[download$=".rvt"]');
    assert.equal(downgraded.toString('hex', 0, 8), 'd0cf11e0a1b11ae1');
    await page.getByText('Сведения обработки', { exact: true }).click();
    const report = JSON.parse(await download(page, '#operation-downloads a[download$=".json"]'));
    assert.equal(report.source.release, year);
    assert.equal(report.output.release, Number(target));
    assert.equal(report.output.release, report.profile.release);
    console.log(`Revit ${report.source.release} → ${report.output.release} produces a compound-file copy and matching report.`);

    await page.locator('#operation-input').setInputFiles({
      name: 'damaged.rvt', mimeType: 'application/octet-stream', buffer: Buffer.from('not a compound file')
    });
    await sourceVersion.getByText('Не удалось определить версию.', { exact: false }).waitFor();
    assert(await page.locator('#target-version').isDisabled());
    assert(await page.locator('#run-operation').isDisabled());
    assert.equal(await page.locator('#operation-downloads a').count(), 0);

    await select(page, 'export', rvt);
    await page.locator('input[value=glb]').check();
    await page.locator('#run-operation').click();
    await page.locator('#operation-count').getByText(/% этапа/).waitFor({ timeout: 60_000 });
    const meter = await page.locator('#operation-meter').evaluate(element =>
      ({ value: element.value, max: element.max, determinate: element.hasAttribute('value') }));
    assert(meter.determinate && meter.max > 0 && meter.value >= 0 && meter.value <= meter.max);
    await page.locator('#operation-elapsed').getByText(/Прошло (?!0:00)\d+:\d{2}/).waitFor();
    await page.getByRole('link', { name: 'Версия Revit' }).click();
    await page.locator('#operation-progress').waitFor({ state: 'hidden' });
    await page.getByRole('link', { name: 'Экспорт' }).click();
    await page.locator('#operation-progress').waitFor();
    await page.locator('#cancel-operation').click();
    await page.locator('#operation-status').getByText('Обработка отменена.').waitFor();
    assert(await page.locator('#operation-progress').isHidden());
    assert(await page.locator('#run-operation').isEnabled());

    await page.locator('#operation-input').setInputFiles({
      name: 'damaged.rvt', mimeType: 'application/octet-stream', buffer: Buffer.from('not a compound file')
    });
    await page.locator('input[value=ifc-parameters]').check();
    await page.locator('#run-operation').click();
    await page.locator('#operation-downloads [data-error]').waitFor();
    assert.doesNotMatch(await page.locator('#operation-downloads [data-error]').innerText(), /Program terminated/);
    assert(await page.locator('#operation-progress').isHidden());

    await page.getByRole('link', { name: 'Просмотр' }).click();
    await page.locator('#status[data-error]').getByText('Не удалось открыть модель.', { exact: false }).waitFor();
    assert.deepEqual(outside, []);
    assert.deepEqual(errors, []);
    console.log('Invalid metadata clears the previous version choices, the preview route remains usable, and model data stays local.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
