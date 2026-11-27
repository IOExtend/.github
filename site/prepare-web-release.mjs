import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { downgradeProfiles } from './wwwroot/revit-versions.js';

const [destination, ...arguments_] = process.argv.slice(2);
const fallbackSource = arguments_[0] && !arguments_[0].startsWith('--') ? arguments_.shift() : undefined;
let fastSource;
if (arguments_[0] === '--fast-reader' && arguments_.length === 2) {
  fastSource = arguments_[1];
  arguments_.length = 0;
}
if (!destination || arguments_.length)
  throw new Error('Usage: node prepare-web-release.mjs <published-wwwroot> [single-threaded-wwwroot] [--fast-reader <fast-wwwroot>]');
const root = resolve(destination);
const template = await readFile(new URL('./wwwroot/index.html', import.meta.url), 'utf8');
const entries = [
  'site.css', 'operations.css', 'site.js', 'operations.js', 'i18n.js', 'locale.js', 'translations.js',
  'formats.js', 'reader.js', 'reader-host.js', 'reader-profile.js', 'reader-scratch.js', 'viewer-theme.js',
  'export-worker.js', 'downgrade-worker.js', 'operation-worker.js',
  'revit-versions.js', ...downgradeProfiles.map(year => `profiles/${year}.rvt`),
  'brand/avatar.png', 'brand/banner.png', 'brand/voxel-building.png',
];
const paged = ['mesh-pages-worker.js', 'paged-storage.js', 'paged-viewer.html'];
const parallelProfile = /^export \* as decoders from '\.\/reader-decoders\.js';?$/m;
if (parallelProfile.test(await readFile(join(root, 'reader-profile.js'), 'utf8'))) entries.push('reader-decoders.js');
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

let profile = assets.get('reader-profile.js').toString('utf8');
if (/^export const threaded = true;?$/m.test(profile)) {
  const fallback = await installFallback(fallbackSource);
  profile += "\nexport const fallbackReader = '" + fallback + "'\n";
}
if (fastSource) {
  if (!optional[1]) throw new Error('The fast reader requires the paged fallback.');
  const fast = await installFastReader(fastSource);
  const isolation = await readFile(new URL('./wwwroot/thread-isolation.js', import.meta.url));
  await writeAsset(join(root, 'thread-isolation.js'), isolation);
  profile += "\nexport const fastReader = '" + fast + "'\n";
}
assets.set('reader-profile.js', Buffer.from(profile));

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

async function readReaderModules(ui) {
  const reader = await readFile(join(ui, 'reader.js'));
  const dependencies = ['reader-host.js', 'reader-profile.js', 'viewer-theme.js'];
  if (parallelProfile.test(await readFile(join(ui, 'reader-profile.js'), 'utf8'))) dependencies.push('reader-decoders.js');
  if (reader.includes("from './reader-scratch.js'")) dependencies.push('reader-scratch.js');
  const modules = await Promise.all(dependencies.map(async name => [name, await readFile(join(ui, name))]));
  return new Map([['reader.js', reader], ...modules]);
}

async function installFastReader(source) {
  const index = await readFile(join(source, 'index.html'), 'utf8');
  const revision = index.match(/<script type="module" src="\.\/ui\/([0-9a-f]{24})\/site\.js"/)?.[1];
  if (!revision) throw new Error('The fast reader must be a prepared site release.');
  const modules = await readReaderModules(join(source, 'ui', revision));
  if (!/^export const threaded = false;?$/m.test(modules.get('reader-profile.js').toString('utf8')))
    throw new Error('The fast reader must use the single-threaded coordinator.');
  const loader = modules.get('reader.js').toString('utf8')
    .match(/from '\.\.\/\.\.\/_framework\/(dotnet\.[0-9a-f]{24}\.js)'/)?.[1];
  if (!loader) throw new Error('The fast reader is missing its versioned runtime import.');
  await readFile(join(source, '_framework', loader));
  const directory = 'fast-reader/' + revision;
  const ui = directory + '/ui/' + revision;
  await cp(join(source, '_framework'), join(root, directory, '_framework'), { recursive: true });
  await Promise.all([...modules].map(([name, bytes]) => writeAsset(join(root, ui, name), bytes)));
  return '../../' + ui + '/reader.js';
}

async function installFallback(source) {
  const manifest = join(root, 'fallback-reader.json');
  let configuration;
  if (source) {
    const index = await readFile(join(source, 'index.html'), 'utf8');
    const revision = index.match(/<script type="module" src="\.\/ui\/([0-9a-f]{24})\/site\.js"/)?.[1];
    if (!revision) throw new Error('The single-threaded fallback must be a prepared site release.');
    const ui = join(source, 'ui', revision);
    const profile = await readFile(join(ui, 'reader-profile.js'), 'utf8');
    if (!/^export const threaded = false;?$/m.test(profile))
      throw new Error('The fallback reader must use a single-threaded runtime.');
    const paged = await readFile(join(ui, 'mesh-pages-worker.js')).then(() => true, error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    if (paged !== Boolean(optional[1]))
      throw new Error('Publish the threaded and fallback readers with the same paging option.');
    const destination = join(root, 'fallback', revision);
    const modules = await readReaderModules(ui);
    await cp(join(source, '_framework'), join(destination, '_framework'), { recursive: true });
    await Promise.all([...modules].map(([name, bytes]) =>
      writeAsset(join(destination, 'ui', revision, name), bytes)));
    configuration = { revision, paged };
  } else {
    const contents = await readFile(manifest, 'utf8').catch(error => {
      if (error.code === 'ENOENT')
        throw new Error('A threaded site release requires a prepared single-threaded fallback.');
      throw error;
    });
    configuration = JSON.parse(contents);
  }
  const { revision, paged } = configuration;
  if (typeof revision !== 'string' || !/^[0-9a-f]{24}$/.test(revision) || paged !== Boolean(optional[1]))
    throw new Error('Invalid fallback reader configuration.');
  const directory = `fallback/${revision}`;
  const ui = `${directory}/ui/${revision}`;
  const modules = await readReaderModules(join(root, ui));
  const loader = modules.get('reader.js').toString('utf8')
    .match(/from '\.\.\/\.\.\/_framework\/(dotnet\.[0-9a-f]{24}\.js)'/)?.[1];
  if (!loader) throw new Error('The fallback reader is missing its versioned runtime import.');
  await readFile(join(root, directory, '_framework', loader));
  if (source) await writeFile(manifest, JSON.stringify(configuration));
  return `../../${ui}/reader.js`;
}

await Promise.all([...assets].map(([name, bytes]) => writeAsset(join(root, revision, name), bytes)));
const index = join(root, 'index.html');
const next = index + '.' + process.pid + '.html';
await writeAsset(next, Buffer.from(html));
await rename(next + '.br', index + '.br');
await rename(next + '.gz', index + '.gz');
await rename(next, index);
console.log(`Site release: ${revision}`);
