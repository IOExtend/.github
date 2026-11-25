import './reader-host.js';
import { dotnet } from './_framework/dotnet.js';
import { pooledGc, threaded } from './reader-profile.js';
import { viewerTheme } from './viewer-theme.js';

const memoryError = /garbage collector could not allocate|failed to allocate memory for the lock free allocator|out of memory|outofmemoryexception|cannot enlarge memory|could not allocate \d+.* bytes/i;
// Release versions of Mono can report the eglib allocation failure with its text stripped.
const monoAllocatorError = /\[MONO\] [^\r\n]*\/eglib\/gmem\.c:\d+ <disabled>/;
const runtimeTrap = /memory access out of bounds/;
const inputWindowSize = 64 * 1024;
const inputWindowCount = 256;
const localizedErrors = new Set([
  'emptyFile', 'chooseRvtNwc', 'view.noGeometry', 'view.pageFailed',
  'view.profileMissing', 'view.scratchFailed', 'view.rangeRead', 'view.outOfRange',
]);

const dropScript = `<script>
  window.addEventListener('dragover', event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('drop', event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    parent.postMessage({ type: 'ioviewer-drop', files: Array.from(event.dataTransfer.files) }, '*');
  });
</script>`;

function viewerPage(bytes) {
  // The upstream standalone template ends with the closing body and HTML tags.
  const tailOffset = Math.max(0, bytes.length - 256);
  const tail = new TextDecoder().decode(bytes.subarray(tailOffset));
  const closeBody = tail.lastIndexOf('</body>');
  if (closeBody === -1) throw new Error('view.pageFailed');

  const offset = bytes.length - new TextEncoder().encode(tail.slice(closeBody)).length;
  return new Blob([bytes.subarray(0, offset), `<style>${viewerTheme}</style>`, dropScript, bytes.subarray(offset)], {
    type: 'text/html;charset=utf-8'
  });
}

self.onmessage = async ({ data: { file, scratchDirectory } }) => {
  let exhaustedMemory = false;
  let exhaustedStorage = false;
  let trapped = false;
  let loadingRuntime = false;
  const scratch = [];
  const scratchLengths = [0, 0];
  let scratchBytes = 0;
  const logError = console.error;
  console.error = (...messages) => {
    // Mono emits the reason before throwing an opaque WebAssembly ExitStatus.
    for (const message of messages) {
      if (typeof message !== 'string' && !(message instanceof Error)) continue;
      const diagnostic = String(message);
      exhaustedMemory ||= memoryError.test(diagnostic) || monoAllocatorError.test(diagnostic);
      trapped ||= runtimeTrap.test(diagnostic);
    }
    logError.apply(console, messages);
  };

  let result;
  try {
    if (scratchDirectory && globalThis.FileSystemFileHandle?.prototype.createSyncAccessHandle) {
      try {
        for (const name of ['partitions', 'triangles']) {
          const handle = await scratchDirectory.getFileHandle(name, { create: true });
          scratch.push(await handle.createSyncAccessHandle());
        }
      } catch (error) {
        if (!['SecurityError', 'NotAllowedError', 'NotSupportedError'].includes(error.name)) throw error;
        console.debug('Временное хранилище недоступно. Используем обычное чтение модели.');
      }
    }
    let warnings = 0;
    let errors = 0;
    let triangles = 0;
    let html;
    let failure;
    const inputWindows = new Map();
    let totalInputBytes = 0;
    let maxWindowBytes = 0;
    let lastLoggedPercent = -1;
    let checkingContainer = true;
    let nextContainerReport = 0;
    const fileReader = new FileReaderSync();
    loadingRuntime = true;
    if (threaded) {
      dotnet.withEnvironmentVariable('DOTNET_PROCESSOR_COUNT', String(Math.min(4, navigator.hardwareConcurrency || 1)));
      // .NET 10's generated interpreter stubs import a heap capped at 2 GiB.
      dotnet.withRuntimeOptions(['--no-jiterpreter-traces-enabled']);
    }
    // Mono's WebAssembly heap cannot shrink. Collect temporary RVT decode data before growing it.
    const runtime = /\.rvt$/i.test(file.name)
      ? dotnet.withEnvironmentVariable('MONO_GC_PARAMS', pooledGc ? 'soft-heap-limit=512m,nursery-size=16m' : 'soft-heap-limit=512m')
      : dotnet;
    const { getAssemblyExports, getConfig, localHeapViewU8, Module, setModuleImports } = await runtime.create();
    if (threaded)
      console.debug('IOExtend shared heap', localHeapViewU8().buffer instanceof SharedArrayBuffer);
    const setSgenPool = Module?._ioextend_set_sgen_pool;
    if (pooledGc && typeof setSgenPool !== 'function')
      throw new Error('view.profileMissing');
    function transfer(index, offset, address, count, writing) {
      const handle = scratch[index];
      const start = address >>> 0;
      const bytes = localHeapViewU8().subarray(start, start + count);
      if (!handle || bytes.length !== count) throw new Error('view.scratchFailed');
      if (!writing) return handle.read(bytes, { at: offset });
      let written;
      try {
        written = handle.write(bytes, { at: offset });
      } catch (error) {
        exhaustedStorage = error.name === 'QuotaExceededError' || /no space available/i.test(error.message);
        throw error;
      }
      const previous = scratchBytes;
      scratchLengths[index] = Math.max(scratchLengths[index], offset + written);
      scratchBytes = scratchLengths[0] + scratchLengths[1];
      const interval = 256 * 1024 * 1024;
      if (Math.floor(previous / interval) < Math.floor(scratchBytes / interval))
        console.debug('IOExtend scratch', JSON.stringify({ scratchBytes, wasmBytes: localHeapViewU8().byteLength }));
      return written;
    }
    setModuleImports('viewer', {
      updateGcProfile(phase, total) {
        if (phase === 'build-model' && total > 0) setSgenPool(1);
      },
      scratchTransfer: transfer.bind(null, 0),
      triangleTransfer: transfer.bind(null, 1),
      resetPartitionScratch() {
        scratch[0].truncate(0);
        const partitionBytes = scratchLengths[0];
        scratchLengths[0] = 0;
        scratchBytes = scratchLengths[1];
        if (partitionBytes > 0)
          console.debug('IOExtend partitions released', JSON.stringify({ partitionBytes, scratchBytes }));
      },
      reportCluster(count) { triangles = count; },
      reportHtml(bytes) { html = viewerPage(bytes); },
      reportFailure(detail, parallelFailure) {
        failure = Object.assign(new Error(detail), { parallelFailure });
      },
      reportScene(elements, instances, geometries) {
        console.debug('IOExtend scene', JSON.stringify({ elements, instances, geometries, warnings, errors }));
      },
      readRange(offset, destination) {
        let copied = 0;
        while (copied < destination.length) {
          const start = Math.floor(offset / inputWindowSize) * inputWindowSize;
          let fileWindow = inputWindows.get(start);
          if (fileWindow === undefined) {
            const end = Math.min(start + inputWindowSize, file.size);
            fileWindow = new Uint8Array(fileReader.readAsArrayBuffer(file.slice(start, end)));
            if (fileWindow.length !== end - start) throw new Error('view.rangeRead');
            if (inputWindows.size === inputWindowCount) inputWindows.delete(inputWindows.keys().next().value);
            totalInputBytes += fileWindow.length;
            maxWindowBytes = Math.max(maxWindowBytes, fileWindow.length);
            if (checkingContainer && performance.now() >= nextContainerReport) {
              nextContainerReport = performance.now() + 500;
              self.postMessage({ progress: { percent: 5, key: 'view.checkBytes', completed: totalInputBytes / (1024 * 1024) } });
            }
          } else {
            inputWindows.delete(start);
          }
          inputWindows.set(start, fileWindow);
          const inside = offset - start;
          const length = Math.min(destination.length - copied, fileWindow.length - inside);
          if (length <= 0) throw new Error('view.outOfRange');
          destination.set(fileWindow.subarray(inside, inside + length), copied);
          copied += length;
          offset += length;
        }
      },
      reportProgress(percent, key, completed, total) {
        checkingContainer = false;
        if (key === 'view.geometry') {
          console.debug('IOExtend geometry', JSON.stringify({ key, completed, total, wasmBytes: localHeapViewU8().byteLength }));
        }
        if (percent !== lastLoggedPercent) {
          console.debug('IOExtend memory', JSON.stringify({
            percent, fileBytes: file.size, totalInputBytes, maxWindowBytes, wasmBytes: localHeapViewU8().byteLength, scratchBytes
          }));
          lastLoggedPercent = percent;
        }
        self.postMessage({ progress: { percent, key, completed, total } });
      },
      reportDiagnostics(warningCount, errorCount) {
        warnings = warningCount;
        errors = errorCount;
        self.postMessage({ progress: { percent: 96, key: 'view.prepare' } });
      }
    });

    const exports = await getAssemblyExports(getConfig().mainAssemblyName);
    loadingRuntime = false;
    self.postMessage({ progress: { percent: 5, key: 'view.check' } });
    nextContainerReport = performance.now() + 500;
    const { Program } = exports;
    const bytes = scratch.length === 2 && typeof Program.OpenPagedModel === 'function'
      ? await Program.OpenPagedModel(file.name, file.size)
      : await Program.OpenModel(file.name, file.size, scratch.length === 2);
    if (failure) throw failure;
    if (bytes?.length) html = viewerPage(bytes);
    if (!(triangles > 0) && !html) throw new Error('view.pageFailed');
    result = { warnings, errors, ...(triangles > 0 ? { triangles } : { html }) };
  } catch (error) {
    const detail = error?.message;
    const outOfMemory = exhaustedMemory || memoryError.test(detail ?? '');
    if (exhaustedStorage)
      result = { localized: { key: 'view.storage' } };
    else if (outOfMemory)
      result = { localized: { key: 'view.memory' } };
    else if (localizedErrors.has(detail))
      result = { localized: { key: detail } };
    else result = detail ? { error: detail } : { localized: { key: 'processFailed' } };
    if (threaded && !exhaustedStorage)
      result.retryable = loadingRuntime || outOfMemory || trapped || error?.parallelFailure === true ||
        error instanceof WebAssembly.RuntimeError || runtimeTrap.test(detail ?? '');
  } finally {
    console.error = logError;
    for (const handle of scratch) {
      try {
        handle.close();
      } catch (error) {
        console.warn('Не удалось закрыть временные данные модели.', error);
      }
    }
  }
  self.postMessage(result);
};
