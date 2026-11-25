const assert = require('node:assert/strict');
const { copyFile, mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const [url, nwc, rvt] = process.argv.slice(2);
assert(url && nwc, 'Usage: node localization-smoke.cjs <url> <nwc> [<rvt>]');
const origin = new URL(url).origin;

(async () => {
  const { dictionaries } = await import('./wwwroot/translations.js');
  const { locales } = await import('./wwwroot/locale.js');
  const keys = Object.keys(dictionaries.en).sort();
  const placeholders = text => [...text.matchAll(/\{\w+\}/g)].map(([token]) => token).sort();
  for (const locale of locales) {
    assert.deepEqual(Object.keys(dictionaries[locale]).sort(), keys, locale);
    for (const key of keys) {
      assert(dictionaries[locale][key].trim(), `${locale} ${key}`);
      assert.deepEqual(placeholders(dictionaries[locale][key]), placeholders(dictionaries.en[key]), `${locale} ${key}`);
    }
  }

  const directory = await mkdtemp(path.join(tmpdir(), 'ioextend-languages-'));
  const browser = await chromium.launch({ executablePath: process.env.VIEWER_CHROME });
  try {
    const context = await browser.newContext({ acceptDownloads: true, locale: 'es-MX' });
    const page = await context.newPage();
    const pageErrors = [];
    const externalRequests = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (requestUrl.protocol.startsWith('http') && requestUrl.origin !== origin)
        externalRequests.push(request.url());
    });
    await page.goto(url);
    const picker = page.locator('#site-language');
    await page.getByRole('heading', { name: dictionaries.es.drop }).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'es');
    assert.deepEqual(await picker.locator('option').evaluateAll(options => options.map(option => option.value)), ['auto', ...locales]);
    for (const locale of locales) {
      await picker.selectOption(locale);
      await page.getByRole('heading', { name: dictionaries[locale].drop }).waitFor();
      assert.equal(await page.locator('html').getAttribute('lang'), locale);
    }
    await picker.selectOption('de');
    await page.setViewportSize({ width: 320, height: 700 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.reload();
    await page.getByRole('heading', { name: dictionaries.de.drop }).waitFor();
    assert.equal(await picker.inputValue(), 'de');
    await picker.selectOption('auto');
    await page.getByRole('heading', { name: dictionaries.es.drop }).waitFor();
    await page.setViewportSize({ width: 1280, height: 900 });

    for (const [filePath, kind] of [[nwc, 'nwc'], ...(rvt ? [[rvt, 'rvt']] : [])]) {
      await page.locator('.tools-nav a[href="#view"]').click();
      await page.locator('#file-input').setInputFiles(filePath);
      await page.locator('#model-name').getByText(path.basename(filePath), { exact: true }).waitFor({ timeout: 360_000 });
      const viewer = page.frameLocator('#viewer');
      await viewer.getByRole('button', { name: 'Modelo', exact: true }).waitFor({ timeout: 360_000 });
      assert.equal(await viewer.locator('#ioviewer-language').count(), 0);
      const readerRequests = [];
      const recordReader = request => { if (new URL(request.url()).pathname.endsWith('/reader.js')) readerRequests.push(request.url()); };
      page.on('request', recordReader);
      await picker.selectOption('ja');
      await viewer.getByRole('button', { name: 'モデル', exact: true }).waitFor({ timeout: 60_000 });
      assert.equal(await viewer.locator('html').getAttribute('lang'), 'ja');
      assert.deepEqual(readerRequests, []);
      page.off('request', recordReader);
      console.log(`Embedded ${kind.toUpperCase()} switched languages without reading the source again.`);

      await page.locator('a[href="#export"]').click();
      await page.locator('#operation-input').setInputFiles(filePath);
      await page.locator('input[value=html]').check();
      await picker.selectOption('fr');
      assert(await page.locator('input[value=html]').isChecked());
      const gate = Promise.withResolvers();
      const blockWorker = async route => {
        await gate.promise;
        await route.continue();
      };
      await page.route('**/export-worker.js', blockWorker, { times: 1 });
      await page.getByRole('button', { name: dictionaries.fr.exportAction }).click();
      try {
        await page.locator('#operation-progress').waitFor();
        await picker.selectOption('de');
        assert.match(await page.locator('#operation-phase').innerText(), /Eigenständiger 3D-Viewer/);
      } finally {
        gate.resolve();
      }
      const link = page.getByRole('link', { name: /^Herunterladen .*\.html$/ });
      const error = page.locator('#operation-downloads [data-error]');
      await link.or(error).waitFor({ timeout: 360_000 });
      assert(await link.isVisible(), await page.locator('#operation-results').innerText());
      const started = page.waitForEvent('download');
      await link.click();
      const download = await started;
      assert.equal(await download.failure(), null);
      const exported = path.join(directory, kind + '.html');
      await copyFile(await download.path(), exported);

      const offline = await browser.newContext({ locale: 'zh-TW', offline: true });
      try {
        const standalone = await offline.newPage();
        standalone.on('pageerror', error => pageErrors.push(error.message));
        await standalone.goto(pathToFileURL(exported).href);
        await standalone.getByRole('button', { name: '模型', exact: true }).waitFor();
        assert.equal(await standalone.locator('html').getAttribute('lang'), 'zh-Hant');
        await standalone.locator('#ioviewer-language').selectOption('it');
        await standalone.getByRole('button', { name: 'Modello', exact: true }).waitFor();
        console.log(`Standalone ${kind.toUpperCase()} switched languages offline.`);
      } finally {
        await offline.close();
      }
      await picker.selectOption('auto');
    }
    await page.locator('a[href="#downgrade"]').click();
    await picker.selectOption('pt');
    await page.getByLabel(dictionaries.pt.targetVersion).waitFor();
    assert.deepEqual(externalRequests, []);
    assert.deepEqual(pageErrors, []);
    console.log('Site locale detection, persistence, 11 dictionaries, mobile layout, embedded and exported offline viewers verified.');
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
