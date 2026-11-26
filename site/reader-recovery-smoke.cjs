const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { basename, join } = require('node:path');
const { chromium } = require('playwright');

const [url, rvt, unisolatedUrl] = process.argv.slice(2);
assert(url && rvt, 'Usage: node reader-recovery-smoke.cjs <isolated-url> <rvt> [unisolated-url]');

async function test(url, isolated, fault) {
  const directory = await mkdtemp(join(process.env.VIEWER_PROFILE_ROOT || tmpdir(), 'ioextend-recovery-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(directory, {
      executablePath: process.env.VIEWER_CHROME || undefined,
      locale: 'ru-RU',
      serviceWorkers: 'block',
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const page = context.pages()[0];
    if (fault === 'startup') await page.clock.install();
    const errors = [];
    const external = [];
    const primary = [];
    const fallback = [];
    let mode = isolated ? 'invalid' : 'normal';
    await context.route('**/*', async route => {
      const request = new URL(route.request().url());
      if (request.origin !== new URL(url).origin || !['GET', 'HEAD'].includes(route.request().method())) {
        external.push(request.origin);
        return route.abort();
      }
      if (!request.pathname.endsWith('/reader.js')) return route.continue();
      const isFallback = request.pathname.includes('/fallback/');
      (isFallback ? fallback : primary).push(request.pathname);
      if (!isFallback && ['invalid', 'trap'].includes(mode)) {
        const response = await route.fetch();
        const source = await response.text();
        const begin = 'const fileReader = new FileReaderSync();';
        assert(source.includes(begin), 'Missing managed reader entry point');
        const failure = mode === 'trap' ? 'WebAssembly.RuntimeError("memory access out of bounds")'
          : 'Error("Invalid Revit container.")';
        return route.fulfill({ response, body: source.replace(begin, `${begin}\nthrow new ${failure};`) });
      }
      if (isFallback && mode === 'missing') return route.abort();
      if (isFallback ? ['waiting', 'ready'].includes(mode) : mode === 'startup') {
        const key = mode === 'ready' ? 'view.check' : 'view.checkBytes';
        const progress = { percent: 5, key, completed: 1 };
        return route.fulfill({ response: await route.fetch(),
          body: `self.onmessage = () => self.postMessage(${JSON.stringify({ progress })});` });
      }
      return route.continue();
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    assert.equal(await page.evaluate(() => crossOriginIsolated), isolated);
    const status = page.locator('#status');
    const input = page.locator('#file-input');
    const model = page.locator('#model-name');
    const cancel = page.locator('#cancel');
    const failed = status.getByText('Не удалось открыть модель.', { exact: false });
    const name = basename(rvt);
    await input.setInputFiles({ name: 'invalid.rvt', mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3]) });
    await failed.waitFor({ timeout: 60000 });
    assert.equal(fallback.length, isolated ? 0 : 1, 'Invalid input does not trigger a retry');
    assert.equal(primary.length, isolated ? 1 : 0);

    const scratch = () => page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      return Array.fromAsync(root.keys()).then(names => names.filter(name => name.startsWith('ioviewer-open-')));
    });
    mode = fault ?? 'normal';
    const starting = fault === 'startup' ? page.waitForEvent('worker', {
      predicate: worker => !worker.url().includes('/fallback/'),
    }) : undefined;
    await input.setInputFiles(rvt);
    if (starting) {
      await starting;
      await status.getByText('прочитано 1 МиБ', { exact: false }).waitFor();
      await page.clock.fastForward(61_000);
    }
    if (isolated) await status.getByText('Повторяем открытие в однопоточном режиме', { exact: false }).waitFor({ timeout: 60000 });
    await model.getByText(name, { exact: true }).or(failed).waitFor({ timeout: 240000 });
    assert.equal(await model.textContent(), name, await status.textContent());
    const handle = await page.locator('#viewer').elementHandle();
    const frame = await handle.contentFrame();
    await frame.waitForFunction(() => window.__ioviewerMeshLod?.stats().draws > 0);
    const scene = await frame.evaluate(() => {
      const { pages, triangles } = window.__ioviewerMeshLod.manifest;
      return { pages: pages.length, triangles };
    });
    assert(scene.pages > 0 && scene.triangles > 0);
    assert.equal(primary.length, isolated ? 2 : 0);
    assert.equal(fallback.length, isolated ? 1 : 2, 'The model is retried exactly once');
    const displayed = await scratch();
    assert.equal(displayed.length, 1, 'The failed attempt released its storage');
    const waitForScratchCleanup = () => page.waitForFunction(async expected => {
      const root = await navigator.storage.getDirectory();
      const names = (await Array.fromAsync(root.keys())).filter(name => name.startsWith('ioviewer-open-'));
      return names.length === 1 && names[0] === expected;
    }, displayed[0]);

    mode = 'ready';
    const replacement = page.waitForEvent('worker', {
      predicate: worker => worker.url().includes('/fallback/'),
    });
    await input.setInputFiles(rvt);
    await replacement;
    await status.getByText(`Проверяем файл · ${name}`, { exact: true }).waitFor();
    if (starting) {
      await page.clock.fastForward(61_000);
      assert(!(await failed.isVisible()), 'Reading remains active after the startup deadline');
    }
    await cancel.waitFor();
    await cancel.click();
    await cancel.waitFor({ state: 'hidden' });
    await waitForScratchCleanup();

    if (starting) {
      const fallbackRequests = fallback.length;
      mode = 'waiting';
      await input.setInputFiles(rvt);
      await status.getByText('прочитано 1 МиБ', { exact: false }).waitFor();
      await page.clock.fastForward(61_000);
      await failed.waitFor({ timeout: 10000 });
      assert.equal(fallback.length, fallbackRequests + 1, 'A stalled fallback ends the request');
      assert(await handle.evaluate(element => element === document.querySelector('#viewer')));
      await waitForScratchCleanup();
    }

    const fallbackRequests = fallback.length;
    mode = 'missing';
    await input.setInputFiles(rvt);
    await failed.waitFor({ timeout: 10000 });
    assert.equal(primary.length, isolated ? 2 : 0, 'Later requests stay on the fallback reader');
    assert.equal(fallback.length, fallbackRequests + 1, 'A failed fallback ends the request');
    assert(await handle.evaluate(element => element === document.querySelector('#viewer')));
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(`Reader recovery passed (${fault ?? 'without isolation'}): ${scene.pages} pages, ${scene.triangles} triangles.`);
  } finally {
    await context?.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}

(async () => {
  await test(url, true, 'trap');
  await test(url, true, 'startup');
  if (unisolatedUrl) await test(unisolatedUrl, false);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
