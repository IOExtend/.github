const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const [url, staticUrl] = process.argv.slice(2);
assert(url, 'Usage: node fast-reader-smoke.cjs <isolated-prepared-site-url> [static-site-url]');

const name = 'fast-reader-smoke.rvt';
const file = { name, mimeType: 'application/octet-stream', buffer: Buffer.from('fixture') };
const html = "<!doctype html><title>Test view</title><script>parent.postMessage({type:'ioviewer-page-ready'}, '*')</script>";
const blob = "new Blob([" + JSON.stringify(html) + "], {type:'text/html'})";
const workerCode = expression => 'self.onmessage = () => self.postMessage(' + expression + ');';
const timedReader = `
  self.onmessage = ({ data }) => {
    if (data.finish) self.postMessage({ html: ${blob} });
    else self.postMessage({ progress: data.progress ?? { percent: 5, key: 'view.check' } });
  };
`;

async function sendToFastReader(page, message) {
  assert(await page.evaluate(() => typeof window.testFastReader?.onmessage === 'function'),
    'The fast reader stopped before the next progress update.');
  return page.evaluate(message => new Promise(resolve => {
    const worker = window.testFastReader;
    worker.addEventListener('message', () => resolve(), { once: true });
    worker.postMessage(message);
  }), message);
}

async function run(browser, scenario) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    const timed = scenario === 'timeout' || scenario === 'progress';
    const slowFrame = scenario === 'slow-frame';
    const frameTimeout = scenario === 'frame-timeout';
    const clocked = timed || slowFrame || frameTimeout || scenario === 'cancel';
    if (clocked) await page.clock.install();
    if (timed) await page.addInitScript(() => {
      const Worker = window.Worker;
      window.Worker = class extends Worker {
        constructor(url, options) {
          super(url, options);
          if (url.pathname.includes('/fast-reader/')) window.testFastReader = this;
        }
      };
    });
    await context.addInitScript(memory => {
      Object.defineProperty(navigator, 'deviceMemory', { value: memory });
      Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8 });
    }, scenario === 'memory' ? 4 : 8);
    if (scenario === 'unisolated') await context.route(url, async route => {
      const response = await route.fetch();
      const headers = response.headers();
      delete headers['cross-origin-opener-policy'];
      delete headers['cross-origin-embedder-policy'];
      await route.fulfill({ response, headers });
    });

    const workers = [];
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    await context.route('**/reader.js', async route => {
      const fast = new URL(route.request().url()).pathname.includes('/fast-reader/');
      workers.push(fast ? 'fast' : 'bounded');
      let body = workerCode('{ html: ' + blob + ' }');
      if (fast) {
        if (scenario === 'failure') return route.abort('failed');
        if (scenario === 'read-error') body = workerCode('{ html: ' + blob + ', errors: 1 }');
        if (scenario === 'renderer') body = workerCode(
          "{ html: new Blob([\"<script>parent.postMessage({type:'ioviewer-page-error',error:'test'}, '*')</script>\"], {type:'text/html'}) }");
        if (slowFrame || frameTimeout) body = workerCode(
          "{ html: new Blob(['<!doctype html><title>Waiting</title>'], {type:'text/html'}) }");
        if (timed) body = timedReader;
        if (scenario === 'cancel') body = workerCode(
          "{ progress: { percent: 5, key: 'view.check' } }");
      }
      return route.fulfill({ response: await route.fetch(), body });
    });

    await page.goto(scenario === 'shared-file' ? url + '#export' : url);
    assert.equal(await page.evaluate(() => crossOriginIsolated), scenario !== 'unisolated');
    const waitForWorker = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/reader.js'));
    if (scenario === 'shared-file') {
      await page.locator('#app[data-mode="export"]').waitFor();
      await page.locator('#operation-input').setInputFiles(file);
      assert.equal(await page.locator('#operation-file').textContent(), name);
      await page.locator('nav a[href="#view"]').click();
    } else {
      await page.locator('#file-input').setInputFiles(file);
    }
    await waitForWorker;

    if (scenario === 'cancel') {
      await page.locator('#cancel').click();
      await page.locator('#cancel').waitFor({ state: 'hidden' });
      await page.clock.fastForward(30_000);
      assert.deepEqual(workers, ['fast']);
      assert.equal(await page.locator('#viewer').isHidden(), true);
    } else {
      if (timed) {
        await page.locator('#open-meter[value="5"]').waitFor();
        await page.clock.fastForward(20_000);
        if (scenario === 'timeout') {
          await sendToFastReader(page, { progress: { percent: 5, key: 'view.check' } });
          await page.clock.fastForward(5_001);
        } else {
          const progress = { percent: 55, key: 'view.paramCount', completed: 1, total: 10 };
          await sendToFastReader(page, { progress });
          await page.clock.fastForward(20_000);
          await sendToFastReader(page, { progress: { ...progress, completed: 2 } });
          await page.clock.fastForward(20_000);
          await sendToFastReader(page, { finish: true });
        }
      }
      if (slowFrame || frameTimeout) {
        const waiting = page.locator('.viewer-loading');
        await waiting.waitFor({ state: 'attached' });
        if (slowFrame) {
          await page.clock.fastForward(5_001);
          assert.equal(await waiting.count(), 1, 'The slow renderer must keep the prepared scene.');
          assert.deepEqual(workers, ['fast']);
          const frame = await (await waiting.elementHandle()).contentFrame();
          await frame.locator('title').waitFor({ state: 'attached' });
          await frame.evaluate(() => parent.postMessage({ type: 'ioviewer-page-ready' }, '*'));
        } else {
          await page.clock.fastForward(25_001);
        }
      }
      await page.locator('#model-name').getByText(name, { exact: true }).waitFor();
      if (!clocked) assert.equal(await page.evaluate(() => performance.getEntriesByName('ioextend:first-frame').length), 1);
      assert.equal(await page.locator('#viewer').count(), 1);
      assert.equal(await page.locator('.viewer-loading').count(), 0);
      assert.deepEqual(workers, ['fast', 'shared-file', 'progress', 'slow-frame'].includes(scenario) ? ['fast']
        : scenario === 'memory' || scenario === 'unisolated' ? ['bounded'] : ['fast', 'bounded']);
    }
    assert.deepEqual(failures, []);
    console.log('Fast reader smoke passed (' + scenario + ').');
  } finally {
    await context.close();
  }
}

async function runIsolation(browser, root) {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'deviceMemory', { value: 8 });
      Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8 });
    });
    const page = await context.newPage();
    const response = await page.goto(root, { waitUntil: 'commit' });
    assert.equal(await response.headerValue('cross-origin-opener-policy'), null);
    assert.equal(await response.headerValue('cross-origin-embedder-policy'), null);
    await page.waitForFunction(() => crossOriginIsolated && Boolean(navigator.serviceWorker.controller));
    assert.equal(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL),
      new URL('thread-isolation.js', root).href);
    console.log('Fast reader smoke passed (static isolation).');
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.VIEWER_CHROME || undefined });
  try {
    for (const scenario of ['fast', 'shared-file', 'failure', 'read-error', 'renderer', 'timeout', 'progress', 'slow-frame', 'frame-timeout', 'cancel', 'memory', 'unisolated'])
      await run(browser, scenario);
    if (staticUrl) await runIsolation(browser, staticUrl);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
