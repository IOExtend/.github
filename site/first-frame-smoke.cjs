const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const { basename } = require('node:path');
const { chromium } = require('playwright');

const [url, rvtPath, nativePath] = process.argv.slice(2);
assert(url && rvtPath && nativePath,
  'Usage: node first-frame-smoke.cjs <isolated-prepared-site-url> <2027-racbasicsampleproject.rvt> <native-export.html>');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const sceneParts = ['meta', 'bin', 'props'];
const checkpointGeometry = 'aae5c11bdfa3b679b57c4dbdaec8b0fc6b34faead93980615a48c51cc428e955';

async function main() {
  assert.equal(sha256(await readFile(rvtPath)), 'c9ce4d013b630028973e4549d3be4b38b3640641948b035680eeea7306491a01',
    'Expected the original Revit 2027 racbasicsampleproject.rvt');
  const nativeHtml = await readFile(nativePath, 'utf8');
  const [nativeMeta, nativeBin, nativeProps] = sceneParts.map(name => {
    const section = nativeHtml.match(new RegExp('<script [^>]*id="ioviewer-' + name + '"[^>]*>([\\s\\S]*?)</script>'));
    assert(section, 'Native HTML is missing ioviewer-' + name);
    return section[1];
  });

  const browser = await chromium.launch({
    executablePath: process.env.VIEWER_CHROME,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const context = await browser.newContext({
      serviceWorkers: 'block', viewport: { width: 1280, height: 750 },
    });
    const requests = [];
    context.on('request', request => requests.push(new URL(request.url()).pathname));
    await context.addInitScript(() => {
      window.parameterProgress = [];
      window.Worker = class extends Worker {
        constructor(url, options) {
          super(url, options);
          if (String(url).includes('/fast-reader/')) {
            this.addEventListener('message', ({ data }) => {
              if (data.progress?.key === 'view.paramCount')
                window.parameterProgress.push([data.progress.completed, data.progress.total]);
            });
          }
        }
      };
    });
    const page = await context.newPage();
    await page.goto(url);
    const capabilities = await page.evaluate(() => ({
      isolated: crossOriginIsolated, cores: navigator.hardwareConcurrency, memoryGiB: navigator.deviceMemory,
    }));
    assert(capabilities.isolated && capabilities.cores >= 5 && capabilities.memoryGiB >= 8,
      'Fast opening requires an isolated page, at least five logical processors and 8 GiB reported by Chromium');
    await page.evaluate(() => {
      const original = document.querySelector('#viewer');
      document.querySelector('#file-input').addEventListener('change', () => {
        const selectedAt = performance.now();
        const observer = new MutationObserver(() => {
          const frame = document.querySelector('#viewer');
          if (!frame || frame === original || frame.inert || !frame.checkVisibility({ opacityProperty: true })) return;
          observer.disconnect();
          // Allow the parent page to paint the revealed iframe before sampling the clock.
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (frame.isConnected && !document.hidden && frame.checkVisibility({ opacityProperty: true }))
              performance.measure('smoke:visible-frame', { start: selectedAt });
          }));
        });
        observer.observe(original.parentNode, { childList: true });
      }, { capture: true, once: true });
    });
    await page.locator('#file-input').setInputFiles(rvtPath);
    const selected = page.locator('#model-name').getByText(basename(rvtPath), { exact: true });
    const error = page.locator('#status[data-error]');
    await selected.or(error).waitFor({ timeout: 120_000 });
    assert(await selected.isVisible() && !await error.isVisible(), await page.locator('#status').textContent());

    await page.waitForFunction(() => performance.getEntriesByName('smoke:visible-frame').length > 0);
    const { readyMs, frameMs } = await page.evaluate(() => ({
      readyMs: performance.getEntriesByName('ioextend:first-frame').at(-1)?.duration,
      frameMs: performance.getEntriesByName('smoke:visible-frame').at(-1).duration,
    }));
    assert(Number.isFinite(readyMs) && readyMs > 0 && frameMs >= readyMs, 'Invalid visible-frame timing');
    const wasm = requests.filter(path => /\/dotnet\.native\.[a-z0-9]+\.wasm$/.test(path));
    assert(wasm.length === 1 && wasm[0].includes('/fast-reader/'),
      `Expected only the fast reader for the visible frame at ${Math.round(frameMs)} ms. WASM requests: ${wasm.join(', ')}`);
    const progress = await page.evaluate(() => window.parameterProgress);
    assert(progress.length > 2, 'Expected progress throughout the parameter scan');
    const total = progress[0][1];
    assert(total > 0 && progress[0][0] === 0 && progress.at(-1)[0] === total,
      'Parameter progress must cover the full input');
    assert(progress.every(([completed, length], i) => length === total &&
      completed >= (progress[i - 1]?.[0] ?? 0) && completed <= total), 'Parameter progress must advance in order');
    const viewer = page.frameLocator('#viewer[src^="blob:"]');
    await viewer.locator('#ioviewer-canvas').waitFor({ state: 'visible' });
    assert(await viewer.locator('#ioviewer-message').isHidden(), 'IOViewer reported a model or WebGL error');
    const [meta, bin, props] = await Promise.all(sceneParts.map(name =>
      viewer.locator('#ioviewer-' + name).textContent()));
    const metadata = JSON.parse(meta);
    const reference = JSON.parse(nativeMeta);
    const { elements, instances, geometries } = metadata;
    const counts = [elements.length, instances.count, geometries.length];
    assert.deepEqual(counts, [466, 730, 403]);
    delete metadata.createdAt;
    delete reference.createdAt;
    assert.deepEqual(metadata, reference, 'Scene metadata differs from the native export');
    assert.equal(sha256(props), sha256(nativeProps), 'Element properties differ from the native export');
    const geometryHash = sha256(bin);
    const nativeGeometryHash = sha256(nativeBin);
    assert(geometryHash === checkpointGeometry || geometryHash === nativeGeometryHash,
      'Unexpected geometry digest: ' + geometryHash);
    const groups = await viewer.locator('#ioviewer-canvas').evaluate(async () => {
      const viewer = window.__ioviewer;
      await viewer.ready;
      const { elements } = JSON.parse(document.querySelector('#ioviewer-meta').textContent);
      for (let index = 0; index < elements.length; index++) {
        viewer.selection.set([index]);
        const groups = document.querySelectorAll('.ioviewer-properties-body section').length;
        if (groups >= 3) return groups;
      }
      return 0;
    });
    assert.equal(groups, 3, 'Expected three property groups in IOViewer');
    console.log(JSON.stringify({ chromium: browser.version(), firstFrameMs: Math.round(frameMs), viewerReadyMs: Math.round(readyMs),
      elements: counts[0], instances: counts[1], packagedGeometries: counts[2], groups, geometryHash, nativeGeometryHash }));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
