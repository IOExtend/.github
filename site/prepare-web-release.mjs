import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { downgradeProfiles } from './wwwroot/revit-versions.js';

if (!process.argv[2]) throw new Error('Usage: node prepare-web-release.mjs <published-wwwroot>');
const root = resolve(process.argv[2]);
const template = await readFile(new URL('./wwwroot/index.html', import.meta.url), 'utf8');
const entries = [
  'site.css', 'operations.css', 'site.js', 'operations.js', 'i18n.js', 'locale.js', 'translations.js',
  'formats.js', 'reader.js', 'reader-profile.js', 'viewer-theme.js',
  'export-worker.js', 'downgrade-worker.js', 'operation-worker.js',
  'revit-versions.js', ...downgradeProfiles.map(year => `profiles/${year}.rvt`),
  'brand/avatar.png', 'brand/banner.png', 'brand/voxel-building.png',
];
const paged = ['mesh-pages-worker.js', 'paged-storage.js', 'paged-viewer.html'];
const optional = await Promise.all(paged.map(file => readFile(join(root, file)).catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
})));
if (optional.some((bytes, i) => i > 0 && Boolean(bytes) !== Boolean(optional[1])))
  throw new Error('The paged viewer and its storage module must be published together.');
if (optional[1]) entries.push(...paged);

const runtimeImports = {
  'reader.js': './_framework/dotnet.js',
  'export-worker.js': './model-export/_framework/dotnet.js',
  'downgrade-worker.js': './revit-downgrade/_framework/dotnet.js',
};
const loaders = new Map();
for (const specifier of Object.values(runtimeImports)) {
  const name = specifier.slice(2);
  const bytes = await readFile(join(root, name)).catch(error => {
    if (error.code === 'ENOENT' && name.includes('/_framework/')) return null;
    throw error;
  });
  if (!bytes) {
    loaders.set(specifier, name);
    continue;
  }
  const fingerprint = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  const versioned = name.replace(/\.js$/, `.${fingerprint}.js`);
  await writeAsset(join(root, versioned), bytes);
  loaders.set(specifier, versioned);
}
const assets = new Map(await Promise.all(entries.map(async name => {
  const filename = join(root, name);
  const runtime = runtimeImports[name];
  if (!runtime) return [name, await readFile(filename)];
  const source = await readFile(filename, 'utf8');
  const specifier = `'${runtime}'`;
  if (!source.includes(specifier)) throw new Error(`Expected the runtime import in ${name}.`);
  return [name, Buffer.from(source.replace(specifier, `'../../${loaders.get(runtime)}'`))];
})));

const digest = createHash('sha256').update(template);
for (const [name, bytes] of assets) {
  digest.update(`${name}\0${bytes.length}\0`).update(bytes);
}
const revision = `ui/${digest.digest('hex').slice(0, 24)}`;
const html = template.replace(/(href|src)="\.\/([^"]+)"/g, (_, attribute, name) => {
  if (!assets.has(name)) throw new Error(`Missing release asset: ${name}`);
  return `${attribute}="./${revision}/${name}"`;
});

async function writeAsset(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  if (/\.(?:css|js|html)$/.test(path)) {
    await Promise.all([
      writeFile(path + '.br', brotliCompressSync(bytes)),
      writeFile(path + '.gz', gzipSync(bytes)),
    ]);
  }
}

await Promise.all([...assets].map(([name, bytes]) => writeAsset(join(root, revision, name), bytes)));
const index = join(root, 'index.html');
const next = index + '.' + process.pid + '.html';
await writeAsset(next, Buffer.from(html));
await rename(next + '.br', index + '.br');
await rename(next + '.gz', index + '.gz');
await rename(next, index);
console.log(`Site release: ${revision}`);
