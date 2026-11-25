import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { viewerTheme } from './wwwroot/viewer-theme.js';

const viewer = resolve(process.argv[2], 'src/IOViewer/Viewer');
const { build } = createRequire(resolve(viewer, 'package.json'))('esbuild');
const output = name => new URL('./wwwroot/' + name, import.meta.url);

const [{ outputFiles }, { outputFiles: storage }, css] = await Promise.all([
  build({
    stdin: {
      contents: await readFile(new URL('./paged-frame.js', import.meta.url), 'utf8'),
      resolveDir: viewer,
      sourcefile: 'paged-frame.js',
    },
    bundle: true, minify: true, format: 'esm', write: false,
  }),
  build({
    entryPoints: [resolve(viewer, 'src/stream/meshStorage.js')],
    bundle: true, minify: true, format: 'esm', write: false,
  }),
  readFile(resolve(viewer, 'styles/viewer.css'), 'utf8'),
]);

const html = `<!doctype html>
<html lang="ru">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src blob: data:; base-uri 'none'; form-action 'none'">
<title>IOViewer</title>
<style>${css.replace(/<\/style/gi, '<\\/style')}
${viewerTheme}
#stream-controls { left: 50%; top: 14px; transform: translateX(-50%); padding: 6px; display: flex; gap: 6px; }
#stream-controls > * { background: var(--button); color: var(--text); border: 1px solid var(--border); border-radius: 4px; padding: 6px; }
</style>
<canvas id="ioviewer-canvas" aria-label="3D-модель"></canvas>
<div id="ioviewer-ui">
  <div id="stream-controls" class="ioviewer-floating">
    <button type="button" id="fit">Показать модель целиком</button>
    <button type="button" id="retry" hidden>Повторить загрузку</button>
  </div>
  <div id="ioviewer-message" role="alert" hidden></div>
  <div id="ioviewer-status"></div>
</div>
<script type="module">${outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>
</html>
`;

await Promise.all([
  writeFile(output('paged-viewer.html'), html),
  writeFile(output('paged-storage.js'), storage[0].text),
]);
