const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname, join, resolve, sep } = require('node:path');
const { chromium } = require('playwright');

const [directory] = process.argv.slice(2);
assert(directory, 'Usage: node release-smoke.cjs <published-wwwroot>');
const root = resolve(directory);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };

(async () => {
  const template = await readFile(join(__dirname, 'wwwroot', 'index.html'), 'utf8');
  const release = await readFile(join(root, 'index.html'), 'utf8');
  let phase = 'old';
  let oldCssRequests = 0;
  const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url, 'http://127.0.0.1');
    try {
      if (pathname === '/') {
        const html = phase === 'old' ? '<link rel="stylesheet" href="./site.css"><p>Old release</p>'
          : phase === 'mixed' ? template.replace('width="224" height="63"', 'width="1280" height="360"')
            : release;
        response.writeHead(200, { 'Content-Type': types['.html'], 'Cache-Control': 'no-store' });
        return response.end(html);
      }
      if (pathname === '/site.css') {
        oldCssRequests++;
        if (phase === 'old') {
          response.writeHead(200, { 'Content-Type': 'text/css', 'Cache-Control': 'public, max-age=86400' });
          return response.end('body { background: #111820 }');
        }
      }
      if (phase === 'no-css' && pathname.endsWith('.css')) {
        response.writeHead(503, { 'Cache-Control': 'no-store' });
        return response.end();
      }
      const filename = resolve(root, '.' + pathname);
      assert(filename.startsWith(root + sep));
      const bytes = await readFile(filename);
      response.writeHead(200, {
        'Content-Type': types[extname(filename)] ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400'
      });
      response.end(bytes);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const browser = await chromium.launch({ executablePath: process.env.VIEWER_CHROME });
    try {
      const base = 'http://127.0.0.1:' + server.address().port + '/';
      // Exercise the browser HTTP cache independently of viewer isolation.
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1707, height: 780 }, deviceScaleFactor: 2.25, locale: 'ru-RU' });
      const page = await context.newPage();
      const logo = page.locator('.brand img');
      await page.goto(base);
      assert.equal(oldCssRequests, 1);
      phase = 'mixed';
      await page.goto(base + '?revision=mixed');
      assert.equal(oldCssRequests, 1, 'The browser kept the old CSS in its normal HTTP cache.');
      assert.equal((await logo.boundingBox()).width, 1280, 'The cached stylesheet reproduces the oversized banner.');

      phase = 'release';
      await page.goto(base + '?revision=release');
      const css = await page.locator('link[rel=stylesheet]').evaluateAll(links => links.map(link => link.getAttribute('href')));
      assert.match(css[0], /^\.\/ui\/[a-f0-9]{24}\/site\.css$/);
      assert.equal(css[1], css[0].replace('site.css', 'operations.css'));
      await page.reload();
      assert.equal(oldCssRequests, 1, 'The updated page does not request the old stylesheet URL.');
      assert.equal((await logo.boundingBox()).width, 224);
      assert.equal(await page.locator('.header-inner').evaluate(node => getComputedStyle(node).display), 'grid');
      await page.getByRole('link', { name: 'Экспорт', exact: true }).click();
      await page.getByRole('heading', { name: 'Экспорт модели' }).waitFor();
      await context.close();

      phase = 'no-css';
      const fallback = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 320, height: 780 } });
      await fallback.goto(base);
      assert.equal((await fallback.locator('.brand img').boundingBox()).width, 224);
      await fallback.close();
      console.log('Reproduced the oversized logo with a warm cache. Normal reload loads the matching release. The logo remains compact if CSS is unavailable.');
    } finally {
      await browser.close();
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
