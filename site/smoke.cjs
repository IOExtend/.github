const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');
const { tmpdir } = require('node:os');
const { basename, join, resolve, sep } = require('node:path');
const { chromium } = require('playwright');

const [url, rvtPath, nwcPath] = process.argv.slice(2);
assert(url && rvtPath && nwcPath, 'Usage: node smoke.cjs <preview-url> <rvt> <nwc>');

async function drop(target, files) {
  await target.evaluate(items => {
    const dataTransfer = new DataTransfer();
    for (const { name, bytes } of items) {
      dataTransfer.items.add(new File([Uint8Array.from(atob(bytes), char => char.charCodeAt(0))], name));
    }
    document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, files);
}

(async () => {
  const parent = resolve(process.env.VIEWER_PROFILE_ROOT || tmpdir());
  const profile = await mkdtemp(join(parent, 'ioextend-smoke-'));
  let browser;
  try {
    // A regular profile exercises OPFS in the same storage mode as a normal visit to the site.
    browser = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.VIEWER_CHROME || undefined,
      locale: 'ru-RU',
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    });
    const page = browser.pages()[0];
    const errors = [];
    const browserOutput = [];
    const memoryUpdates = [];
    const unexpectedRequests = [];
    const origin = new URL(url).origin;
    await page.route('**/*', async route => {
      const request = route.request();
      const requestUrl = new URL(request.url());
      if (['GET', 'HEAD'].includes(request.method()) && requestUrl.origin === origin
          && !/^\/(manifest\.json|overview\.bin|pages\/|shapes\/|elements\/)/.test(requestUrl.pathname)) {
        await route.continue();
      } else {
        unexpectedRequests.push(request.method() + ' ' + new URL(request.url()).origin);
        await route.abort();
      }
    });
    let sceneMetrics;
    let partitionRelease;
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') browserOutput.push(message.text());
      const text = message.text();
      if (text.startsWith('IOExtend memory ')) memoryUpdates.push(JSON.parse(text.slice('IOExtend memory '.length)));
      if (text.startsWith('IOExtend scene ')) sceneMetrics = JSON.parse(text.slice('IOExtend scene '.length));
      if (text.startsWith('IOExtend partitions released '))
        partitionRelease = { ...JSON.parse(text.slice('IOExtend partitions released '.length)), beforeScene: !sceneMetrics };
    });
    await page.goto(url);
    const status = page.locator('#status');
    const viewer = page.frameLocator('#viewer');
    const progress = page.getByRole('progressbar', { name: 'Примерный прогресс открытия модели' });
    await page.evaluate(() => {
      const meter = document.querySelector('#open-meter');
      const status = document.querySelector('#status');
      window.openingUpdates = [];
      window.stagedViewers = [];
      new MutationObserver(() => {
        window.openingUpdates.push({ value: meter.value, status: status.textContent });
      }).observe(meter, { attributeFilter: ['value'] });
      new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!node.matches?.('iframe.viewer-loading')) continue;
            const { visibility, position, opacity } = getComputedStyle(node);
            window.stagedViewers.push({ visibility, position, opacity, inert: node.inert });
          }
        }
      }).observe(document.querySelector('#workspace'), { childList: true });
    });

    assert(await progress.isHidden(), 'Progress is hidden before opening a file');
    await drop(page, [{ name: 'unsupported.ifc', bytes: 'AQ==' }]);
    await status.getByText('Выберите файл RVT или NWC.').waitFor();
    await drop(page, [{ name: 'empty.rvt', bytes: '' }]);
    await status.getByText('Размер файла', { exact: false }).waitFor();
    await drop(page, [{ name: 'invalid.rvt', bytes: 'AQID' }]);
    await status.getByText('Не удалось открыть модель.', { exact: false }).waitFor({ timeout: 60000 });
    assert(await progress.isHidden(), 'Progress disappears on failure');

    for (const [name, path] of [['example.nwc', nwcPath], [basename(rvtPath), rvtPath]]) {
      const started = performance.now();
      memoryUpdates.length = 0;
      sceneMetrics = undefined;
      partitionRelease = undefined;
      await page.evaluate(() => { window.openingUpdates.length = 0; });
      if (name.endsWith('.nwc')) {
        const bytes = (await readFile(path)).toString('base64');
        await drop(page, [{ name, bytes }]);
      } else {
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Открыть другую модель' }).click();
        await (await chooser).setFiles(path);
      }

      try {
        const loaded = page.locator('#model-name').getByText(name);
        const failed = status.getByText('Не удалось открыть модель.', { exact: false });
        await loaded.or(failed).waitFor({ timeout: 420000 });
        assert(await loaded.isVisible(), 'The browser could not open the model.');
      } catch (error) {
        throw new Error([name + ': ' + await status.textContent(), ...browserOutput].join('\n'), { cause: error });
      }

      await viewer.locator('#ioviewer-canvas').waitFor();
      const frame = await page.locator('#viewer').elementHandle().then(handle => handle.contentFrame());
      await frame.waitForFunction(() => Boolean(window.__ioviewer || window.__ioviewerMeshLod));
      const paged = await frame.evaluate(async () => {
        const view = window.__ioviewerMeshLod;
        if (!view) { await window.__ioviewer.ready; return null; }
        await view.ready;
        const { manifest } = view;
        const index = manifest.elements.findIndex(element => element.size > 0);
        const property = index >= 0 && await (await globalThis.IOVIEWER_MESH_SOURCE.fetch('/elements/' + index)).json();
        const entry = Object.values(property?.properties ?? {}).flatMap(Object.entries)
          .find(([, value]) => typeof value === 'string' && value.trim());
        if (entry) view.selection.set([index]);
        return { pages: manifest.pages.length, triangles: manifest.triangles,
          elements: manifest.elements.length, entry,
          propertyMatches: property?.id === manifest.elements[index]?.id && index >= 0 };
      });
      assert(await progress.isHidden(), 'Progress disappears on success');
      const updates = await page.evaluate(() => window.openingUpdates);
      assert(updates.some(update => update.value > 10 && update.value < 90), 'Progress advances before completion');
      assert(updates.every((update, index) => !index || update.value >= updates[index - 1].value), 'Progress never moves backwards');
      if (name.endsWith('.rvt')) {
        assert(updates.some(update => /Читаем записи элементов · .* из .* блоков/.test(update.status)), 'RVT reports record scan counts');
        assert(updates.some(update => /из \d+ проходов/.test(update.status)), 'RVT reports block passes');
        assert(updates.some(update => /из .* МиБ/.test(update.status)), 'RVT reports byte counts');
        assert(updates.some(update => update.status.includes('Ищем дополнительные блоки геометрии')), 'RVT reports geometry recovery');
        assert(updates.some(update => /Сопоставляем имена и свойства · .* из .* блоков/.test(update.status)), 'RVT reports name scan counts');
        assert(updates.some(update => /Собираем модель Revit · .* из .* записей/.test(update.status)), 'RVT reports model construction counts');
        assert(updates.some(update => update.status.includes('Уточняем единицы измерения и координаты')), 'RVT reports the last stage of model resolution');
        assert(updates.some(update => update.status.includes('Готовим модель к построению 3D-сцены')), 'RVT reports document preparation');
        assert(updates.some(update => /Строим 3D-сцену RVT · .* из .* элементов/.test(update.status)), 'RVT reports mesh extraction counts');
        if (process.env.IOEXTEND_REQUIRE_PAGED === '1') {
          assert(paged?.pages > 0 && paged.triangles > 0 && paged.propertyMatches, 'RVT shows local pages and element properties');
          assert.equal(paged.elements, sceneMetrics.elements, 'The page manifest includes every scene element');
          assert(paged.entry, 'The loaded element has a visible property value');
          await frame.waitForFunction(([key, value]) => {
            const panel = document.querySelector('#ioviewer-properties');
            return !panel?.hidden && [...panel.querySelectorAll('tr')].some(row =>
              row.querySelector('th')?.textContent === key && row.querySelector('td')?.textContent === value);
          }, paged.entry);
          await frame.waitForFunction(() => {
            const { draws, triangles } = window.__ioviewerMeshLod.stats();
            return draws > 0 && triangles > 0;
          });
          const number = new Intl.NumberFormat('ru-RU');
          const triangleCount = number.format(paged.triangles);
          const elementCount = number.format(paged.elements);
          assert(updates.some(update => update.status.includes(
            `Собираем страницы · ${triangleCount} из ${triangleCount} треугольников`)), 'RVT reports all triangles written to pages');
          assert(updates.some(update => /Готовим обзор · уровень \d+ · .* из .* страниц/.test(update.status)), 'RVT reports overview progress');
          assert(updates.some(update => update.status.includes(
            `Готовим свойства элементов · ${elementCount} из ${elementCount}`)), 'RVT reports all elements processed for properties');
          assert(updates.some(update => /Открываем просмотр · .* страниц/.test(update.status)), 'RVT reports the number of pages');
          assert.deepEqual(await page.evaluate(() => window.stagedViewers), [
            { visibility: 'visible', position: 'fixed', opacity: '0', inert: true }
          ], 'The sandboxed renderer can draw while the model is opening');
          assert.equal(await page.locator('#viewer').evaluate(node => node.inert), false,
            'The viewer accepts interactions after the first frame');
        }
      }
      const instances = paged ? sceneMetrics?.instances
        : await viewer.locator('#ioviewer-meta').textContent().then(text => JSON.parse(text).instances.count);
      assert(instances > 0, 'Viewer has no instances');
      assert(memoryUpdates.some(update => update.totalInputBytes > 0), 'Viewer reads the source file by range');
      assert(memoryUpdates.every(update => update.maxWindowBytes <= 64 * 1024), 'File read window is bounded to 64 KiB');
      if (paged && name.endsWith('.rvt')) {
        assert(partitionRelease?.partitionBytes > 0, 'The RVT partition scratch was released');
        assert(partitionRelease.beforeScene, 'Partition scratch is released before the scene is ready');
      }
      assert(await viewer.locator('#ioviewer-message').isHidden(), 'Viewer reported a WebGL or model error');
      console.log(name + ': ' + instances + ' mesh instances in ' + Math.round(performance.now() - started) + ' ms'
        + (paged ? ', ' + paged.pages + ' pages, ' + paged.triangles + ' triangles' : ''));
    }

    const loadedFrame = await page.locator('#viewer').elementHandle().then(handle => handle.contentFrame());
    await drop(loadedFrame, [{ name: 'unsupported.ifc', bytes: 'AQ==' }]);
    await status.getByText('Выберите файл RVT или NWC.').waitFor();
    const bytes = (await readFile(nwcPath)).toString('base64');
    await drop(loadedFrame, [{ name: 'replacement.nwc', bytes }]);
    await page.locator('#model-name').getByText('replacement.nwc').waitFor({ timeout: 60000 });
    await viewer.locator('#ioviewer-canvas').waitFor();

    const scratchCount = async () => {
      const directory = await navigator.storage.getDirectory();
      let count = 0;
      for await (const name of directory.keys()) if (name.startsWith('ioviewer-')) count++;
      return count;
    };
    const waitForScratchCount = async expected => {
      const deadline = performance.now() + 30000;
      let count = await page.evaluate(scratchCount);
      while (count !== expected && performance.now() < deadline) {
        await delay(100);
        count = await page.evaluate(scratchCount);
      }
      assert.equal(count, expected, await status.textContent());
    };
    await waitForScratchCount(0);
    await page.locator('#file-input').setInputFiles(rvtPath);
    await progress.waitFor();
    await waitForScratchCount(1);
    await page.waitForFunction(() => {
      const elapsed = document.querySelector('#open-elapsed').textContent;
      return elapsed.startsWith('Прошло ') && elapsed !== 'Прошло 0:00';
    });
    await page.getByRole('button', { name: 'Отменить' }).click();
    await status.getByText('Открытие модели отменено.').waitFor();
    await waitForScratchCount(0);
    assert(await progress.isHidden(), 'Progress disappears on cancellation');
    await page.locator('#model-name').getByText('replacement.nwc').waitFor();

    await page.evaluate(() => {
      const original = FileSystemDirectoryHandle.prototype.getDirectoryHandle;
      const gate = new Promise(resolve => { window.resumeScratchCreation = resolve; });
      FileSystemDirectoryHandle.prototype.getDirectoryHandle = async function (name, options) {
        if (!name.startsWith('ioviewer-')) return original.call(this, name, options);
        window.scratchCreationPending = true;
        await gate;
        try {
          return await original.call(this, name, options);
        } finally {
          FileSystemDirectoryHandle.prototype.getDirectoryHandle = original;
          window.scratchCreationFinished = true;
        }
      };
    });
    await page.locator('#file-input').setInputFiles(rvtPath);
    await page.waitForFunction(() => window.scratchCreationPending === true);
    await page.getByRole('button', { name: 'Отменить' }).click();
    await page.evaluate(() => window.resumeScratchCreation());
    await page.waitForFunction(() => window.scratchCreationFinished === true);
    await waitForScratchCount(0);
    await page.locator('#model-name').getByText('replacement.nwc').waitFor();

    await page.route('**/reader.js', async route => {
      const response = await route.fetch();
      const noSpace = `FileSystemSyncAccessHandle.prototype.write = function () {
        throw new DOMException('No space available for this operation', 'QuotaExceededError');
      };\n`;
      await route.fulfill({ response, body: noSpace + await response.text() });
    });
    await page.locator('#file-input').setInputFiles(rvtPath);
    await status.getByText('Не хватило места для временных данных модели.', { exact: false }).waitFor({ timeout: 60000 });
    await waitForScratchCount(0);
    await page.locator('#model-name').getByText('replacement.nwc').waitFor();

    await page.unroute('**/reader.js');
    const runtimeLoader = /\/_framework\/dotnet(?:\.[0-9a-f]{24})?\.js$/;
    await page.route(runtimeLoader, route => route.fulfill({
      contentType: 'text/javascript',
      body: `
        export const dotnet = {
          withEnvironmentVariable() { return this; },
          async create() {
            console.error('[MONO] /runtime/src/mono/mono/eglib/gmem.c:123 <disabled>');
            throw new Error('Program terminated with exit(1)');
          },
        };`,
    }));
    await page.locator('#file-input').setInputFiles(rvtPath);
    await status.getByText('Браузеру не хватило памяти для обработки модели.', { exact: false }).waitFor();
    await waitForScratchCount(0);
    await page.locator('#model-name').getByText('replacement.nwc').waitFor();
    await page.unroute(runtimeLoader);

    const holdingTab = await browser.newPage();
    try {
      await holdingTab.goto(url);
      const active = await holdingTab.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const name = 'ioviewer-open-' + crypto.randomUUID() + '.tmp';
        await new Promise(resolve => {
          navigator.locks.request(name, () => new Promise(release => {
            window.releaseScratchForTest = release;
            resolve();
          }));
        });
        await root.getDirectoryHandle(name, { create: true });
        await root.getDirectoryHandle('ioviewer-open-' + crypto.randomUUID() + '.tmp', { create: true });
        return name;
      });
      await page.reload();
      await waitForScratchCount(1);
      assert(await page.evaluate(async name => {
        const root = await navigator.storage.getDirectory();
        return Boolean(await root.getDirectoryHandle(name));
      }, active), 'A live tab retains its model pages');
      await holdingTab.evaluate(() => window.releaseScratchForTest());
      await page.reload();
      await waitForScratchCount(0);
    } finally {
      await holdingTab.close();
    }

    assert.deepEqual(errors, []);
    assert.deepEqual(unexpectedRequests, []);
    console.log('Browser smoke passed: drag and drop, progress, cancellation and scratch cleanup, invalid inputs, WebGL and no external requests.');
  } finally {
    await browser?.close();
    if (resolve(profile).startsWith(parent + sep + 'ioextend-smoke-'))
      await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
