import { exportFormats, extensionOf, isRevit } from './formats.js';
import { targetReleases } from './revit-versions.js';

function fail(key, values) {
  throw Object.assign(new Error(key), { localized: { key, values } });
}

function mountInput(fs, directory, file, onRead) {
  fs.mkdir(directory);
  const name = file.name.replace(/[\\/:\u0000-\u001f]/g, '_');
  const path = directory + '/' + name;
  fs.writeFile(path, new Uint8Array());
  const { node } = fs.lookupPath(path);
  node.usedBytes = file.size;
  node.timestamp = file.lastModified;
  const reader = new FileReaderSync();
  const windowSize = 64 * 1024;
  const cache = new Map();
  node.stream_ops = { ...node.stream_ops,
    read(stream, buffer, offset, length, position) {
      const count = Math.min(length, Math.max(0, file.size - position));
      let copied = 0;
      while (copied < count) {
        const start = position - position % windowSize;
        let bytes = cache.get(start);
        if (!bytes) {
          bytes = new Uint8Array(reader.readAsArrayBuffer(file.slice(start, start + windowSize)));
          onRead?.(bytes.length);
          if (cache.size === 256) cache.delete(cache.keys().next().value);
        } else {
          cache.delete(start);
        }
        cache.set(start, bytes);
        const inside = position - start;
        const take = Math.min(count - copied, bytes.length - inside);
        if (take <= 0) fail('sourceReadFailed');
        buffer.set(bytes.subarray(inside, inside + take), offset + copied);
        position += take;
        copied += take;
      }
      return copied;
    },
  };
  return path;
}

export async function runOperation(dotnet, { file, format, target }) {
  let memoryError;
  try {
    const downgrade = format === 'downgrade';
    const probe = format === 'revit-version';
    const spec = exportFormats(file.name).find(candidate => candidate.id === format);
    if (!file.size || (downgrade || probe ? !isRevit(file.name) : !spec))
      fail('invalidOperation');

    let progress = {};
    let bytesRead = 0;
    let bytesWritten = 0;
    let lastUpdate = -Infinity;
    function publish(force = false) {
      if (probe || (!force && performance.now() - lastUpdate < 250)) return;
      lastUpdate = performance.now();
      self.postMessage({ progress: { ...progress, bytesRead, bytesWritten } });
    }
    function stage(phase, completed = 0, total = 0) {
      const changed = phase !== progress.phase || total !== progress.total;
      progress = { phase, completed, total };
      publish(changed || (total > 0 && completed === total));
    }

    stage('runtime');
    const builder = !probe && isRevit(file.name)
      ? dotnet.withEnvironmentVariable('MONO_GC_PARAMS', 'soft-heap-limit=512m')
      : dotnet;
    const runtime = await builder.withModuleConfig({
      printErr(message) {
        const line = String(message);
        if (/Garbage collector could not allocate|Out of memory|Cannot enlarge memory/i.test(line))
          memoryError = line;
        console.error(line);
      },
    }).create();
    runtime.setModuleImports('operation', { reportProgress: stage });
    const fs = runtime.Module.FS;
    const input = mountInput(fs, '/input', file, count => {
      bytesRead += count;
      publish();
    });
    const { Runner } = await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName);
    if (probe) {
      const version = Runner.ReadRevitVersion(input);
      self.postMessage({ version, bytesRead });
      return;
    }
    fs.mkdir('/result');
    const suffix = downgrade ? '.revit-' + target + extensionOf(file.name) : spec.suffix;
    const output = '/result/model' + (downgrade ? extensionOf(file.name) : suffix);
    const report = '/result/downgrade.json';
    let args;
    if (downgrade) {
      stage('metadata');
      if (!targetReleases(Runner.ReadRevitVersion(input)).includes(target)) fail('invalidTarget');
      stage('profile');
      const response = await fetch(new URL(`./profiles/${target}.rvt`, import.meta.url));
      if (!response.ok) fail('profileFailed', { year: target });
      const profile = `/result/profile-${target}.rvt`;
      fs.writeFile(profile, new Uint8Array(await response.arrayBuffer()));
      args = ['downgrade', input, '--target-profile', profile, '--output', output, '--report', report];
    } else {
      args = spec.args(input, output);
    }

    const write = fs.write;
    fs.write = function (stream, ...args) {
      const count = write.call(this, stream, ...args);
      // Some writers save a temporary sibling and rename it after a successful write.
      if (count > 0 && stream.path.startsWith('/result/') &&
          progress.phase !== 'report' && stream.path !== report) {
        bytesWritten += count;
        stage('write');
      }
      return count;
    };
    if (downgrade) {
      const read = fs.read;
      fs.read = function (stream, ...args) {
        if (progress.phase === 'write' && stream.path === output && !stream.isWrite)
          stage('verify');
        return read.call(this, stream, ...args);
      };
    }
    stage(downgrade ? 'plan' : 'decode');
    const result = JSON.parse(Runner.Run(downgrade ? 'RvtIO.Cli' : spec.tool, JSON.stringify(args)));
    const diagnostics = [result.output.trim(), result.diagnostics.trim()].filter(Boolean).join('\n');
    const exists = path => fs.analyzePath(path).exists;
    const stem = file.name.slice(0, -extensionOf(file.name).length);
    if (result.exitCode !== 0 || !exists(output)) {
      const error = result.error || result.diagnostics.trim().split(/\r?\n/).at(-1);
      self.postMessage({
        error,
        localized: error ? undefined : { key: 'missingOutput' },
        diagnostics,
      });
      return;
    }
    if (!fs.stat(output).size) fail('emptyOutput');

    stage('download');
    const reportFile = downgrade && exists(report) ? new File([fs.readFile(report)], stem + '.downgrade.json') : undefined;
    const resultFile = new File([fs.readFile(output)], stem + suffix);
    self.postMessage({ file: resultFile, report: reportFile, diagnostics });
  } catch (error) {
    const message = error?.message;
    self.postMessage(memoryError || error?.name === 'OutOfMemoryException'
      ? { localized: { key: 'operationMemory' }, diagnostics: memoryError ?? message }
      : { error: error?.localized ? undefined : message, localized: error?.localized ?? (!message ? { key: 'processFailed' } : undefined) });
  }
}
