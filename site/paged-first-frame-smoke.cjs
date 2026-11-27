const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { basename, join } = require('node:path');
const { chromium } = require('playwright');

const [url, model, timeoutSeconds = '1800'] = process.argv.slice(2);
const timeout = Number(timeoutSeconds) * 1000;
assert(url && model && Number.isSafeInteger(timeout) && timeout > 0,
  'Usage: node paged-first-frame-smoke.cjs <site-url> <local-rvt> [timeout-seconds]');

async function main() {
  // A fresh persistent profile gives OPFS its normal quota and starts with an empty model cache.
  const directory = await mkdtemp(join(tmpdir(), 'ioextend-paged-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(directory, {
      executablePath: process.env.VIEWER_CHROME,
      serviceWorkers: 'block',
      viewport: { width: 1280, height: 750 },
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const page = context.pages()[0];
    const runtimes = [];
    const origin = new URL(url).origin;
    const externalOrigins = new Set();
    let scene;
    let memory;
    context.on('request', request => {
      const requested = new URL(request.url());
      if (/^https?:$/.test(requested.protocol) && requested.origin !== origin)
        externalOrigins.add(requested.origin);
      if (/\/dotnet\.native\.[^/]+\.wasm$/.test(requested.pathname))
        runtimes.push(requested.pathname);
    });
    page.on('console', message => {
      const line = message.text();
      if (line.startsWith('IOExtend scene ')) scene = JSON.parse(line.slice('IOExtend scene '.length));
      if (line.startsWith('IOExtend memory ')) memory = JSON.parse(line.slice('IOExtend memory '.length));
    });
    await page.goto(url);
    await page.evaluate(() => {
      const status = document.querySelector('#status');
      const oldFrame = document.querySelector('#viewer');
      document.querySelector('#file-input').addEventListener('change', () => {
        const started = performance.now();
        const phases = [];
        window.pagedSmoke = { phases };
        const phaseObserver = new MutationObserver(() => {
          const label = status.textContent.split(' · ', 1)[0];
          if (label && label !== phases.at(-1)?.label)
            phases.push({ label, atMs: Math.round(performance.now() - started) });
        });
        phaseObserver.observe(status, { childList: true, subtree: true });
        const frameObserver = new MutationObserver(() => {
          const frame = document.querySelector('#viewer');
          if (!frame || frame === oldFrame || frame.inert || !frame.checkVisibility({ opacityProperty: true })) return;
          frameObserver.disconnect();
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (frame.isConnected && !document.hidden && frame.checkVisibility({ opacityProperty: true })) {
              window.pagedSmoke.firstFrameMs = Math.round(performance.now() - started);
              phaseObserver.disconnect();
            }
          }));
        });
        frameObserver.observe(oldFrame.parentNode, { childList: true });
        setTimeout(() => {
          if (!window.pagedSmoke.firstFrameMs)
            window.pagedSmoke.atTwoMinutes = status.textContent.split(' · ').slice(0, -1).join(' · ');
        }, 120_000);
      }, { capture: true, once: true });
    });
    await page.locator('#file-input').setInputFiles(model);
    const selected = page.locator('#model-name').getByText(basename(model), { exact: true });
    const error = page.locator('#status[data-error]');
    try {
      await selected.or(error).waitFor({ timeout });
      assert(await selected.isVisible(), await page.locator('#status').textContent());
      await page.waitForFunction(() => window.pagedSmoke.firstFrameMs > 0);
    } catch (failure) {
      const status = await page.locator('#status').textContent();
      console.error(JSON.stringify({ status, memory, runtimes }));
      throw failure;
    }
    const frame = await (await page.locator('#viewer').elementHandle()).contentFrame();
    const render = await frame.evaluate(async () => {
      const view = window.__ioviewerMeshLod;
      if (!view) throw new Error('Expected the paged viewer.');
      const { manifest } = view;
      const propertyIndex = manifest.elements.findIndex(element => element.size > 0);
      const response = await window.IOVIEWER_MESH_SOURCE.fetch('/elements/' + propertyIndex);
      const element = await response.json();
      const { draws, triangles } = view.stats();
      return {
        elements: manifest.elements.length, pages: manifest.pages.length, draws, triangles,
        propertyRead: response.ok && element.id === manifest.elements[propertyIndex]?.id
          && Object.keys(element.properties ?? {}).length > 0,
      };
    });
    assert.equal(externalOrigins.size, 0, 'The viewer contacted an external origin.');
    assert(runtimes.length === 1 && !runtimes[0].includes('/fast-reader/'), 'Expected a single paged reader.');
    assert.equal(scene?.errors, 0);
    assert.equal(render.elements, scene.elements);
    assert(render.pages > 0 && render.draws > 0 && render.triangles > 0 && render.propertyRead);
    assert(await frame.locator('#ioviewer-message').isHidden());
    const timing = await page.evaluate(() => window.pagedSmoke);
    console.log(JSON.stringify({ ...timing, scene, render, memory }));
  } finally {
    try {
      await context?.close();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
