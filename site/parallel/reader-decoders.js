const shardCapacity = 16 * 1024 * 1024;
const namesCapacity = 4 * 1024 * 1024;
const initialGeometryBatchBytes = 128 * 1024;

function createParameterWorker(role, wasmBlob) {
  const worker = new Worker(new URL('./reader.js', import.meta.url), { type: 'module' });
  worker.parameterPriority = new Int32Array(new SharedArrayBuffer(4));
  worker.startup = new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => (data.ready ? resolve() : reject(new Error(data.error)));
    worker.onerror = (event) => reject(new Error(event.message));
  });
  worker.postMessage({ parameterWorker: true, role });
  wasmBlob
    .then((blob) => worker.postMessage({ wasmBlob: blob }))
    .catch((error) => {
      console.warn('IOExtend WASM transfer failed.', error);
      worker.postMessage({ wasmBlob: null });
    });
  return worker;
}

async function startParameterWorker(dotnet, role) {
  try {
    dotnet.withEnvironmentVariable('IOEXTEND_PROBE_GEOMETRY_RESULT_24', '1');
    dotnet.withEnvironmentVariable('IOEXTEND_PROBE_DIRECT_TRIM', '1');
    dotnet.withEnvironmentVariable('IOEXTEND_GREP_EXACT_SOURCES', '1');
    const { getAssemblyExports, getConfig, localHeapViewU8 } = await dotnet.create();
    const { Program } = await getAssemblyExports(getConfig().mainAssemblyName);
    if (role === 'names') {
      let status,
        output,
        failed = false;
      self.onmessage = ({ data: { kind, mailbox, input, index, culture } }) => {
        if (failed) return;
        try {
          if (kind === 'begin') {
            status = new Int32Array(mailbox, 0, 2);
            output = new Uint8Array(mailbox, 8);
            Program.StartWorkerNames(input, culture);
          } else if (kind === 'chunk') Program.ScanWorkerNames(index, input);
          else if (kind === 'finish') {
            const encoded = Program.FinishWorkerNames();
            if (encoded.length > output.length) throw new Error('Name scan exceeds mailbox capacity.');
            output.set(encoded);
            Atomics.store(status, 1, localHeapViewU8().byteLength);
            Atomics.store(status, 0, encoded.length + 1);
            Atomics.notify(status, 0, 1);
          }
        } catch (error) {
          failed = true;
          console.warn('IOExtend name worker', error);
          Atomics.store(status, 0, -1);
          Atomics.notify(status, 0, 1);
        }
      };
      self.postMessage({ ready: true });
      return;
    }
    self.onmessage = async ({
      data: {
        parameterPriority,
        queuedParameters,
        input,
        mailbox,
        geometry,
        yieldDecode,
        work,
        arena,
        transcode,
        inflate,
      },
    }) => {
      const status = new Int32Array(mailbox, 0, 2);
      const output = new Uint8Array(mailbox, 8);
      try {
        let length = 0;
        let omittedBytes = 0;
        function append(encoded) {
          if (arena) {
            const stored = appendGeometryResults(arena, encoded);
            length += stored;
            omittedBytes += encoded.length - stored;
            return;
          }
          if (encoded.length > output.length - length) throw new Error('Worker shard exceeds mailbox capacity.');
          output.set(encoded, length);
          length += encoded.length;
        }
        function decodeGeometry(input) {
          append(Program.DecodeGeometryBatch(input));
        }
        if (inflate) {
          const { source, jobs, claim, output } = inflate;
          for (let i = Atomics.add(claim, 0, 1); i < jobs.length; i = Atomics.add(claim, 0, 1)) {
            await inflatePartitionMember(source, jobs[i], output);
            length += jobs[i].outputEnd - jobs[i].outputStart;
          }
        } else if (transcode) {
          const { schema, width, trackIds, source, plan, jobs, claim, result } = transcode;
          Program.BeginBrowserR22RangeWorker(schema, width, trackIds);
          try {
            for (let i = Atomics.add(claim, 0, 1); i < jobs.length; i = Atomics.add(claim, 0, 1)) {
              const job = jobs[i];
              const encoded = Program.DecodeBrowserR22Range(
                source.subarray(job.start, job.end),
                plan.subarray(job.first, job.last)
              );
              if (encoded.length === 0) throw new Error('R22 range needs sequential element IDs.');
              const at = Atomics.add(result.cursor, 0, encoded.length + 8);
              if (encoded.length + 8 > result.data.length - at)
                throw new Error('R22 range output exceeds capacity.');
              const header = new DataView(result.data.buffer, result.data.byteOffset + at, 8);
              header.setUint32(0, i, true);
              header.setUint32(4, encoded.length, true);
              result.data.set(encoded, at + 8);
              length += encoded.length + 8;
            }
          } finally {
            Program.EndBrowserR22RangeWorker();
          }
        } else if (work) {
          for (;;) {
            const i = Atomics.add(work.next, 0, 1);
            if (i + 1 >= work.ends.length) break;
            decodeGeometry(work.input.subarray(work.ends[i], work.ends[i + 1]));
          }
        } else if (yieldDecode) {
          let yields = 0;
          const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
          let begin = 0;
          for (let end = 0; end < input.length; ) {
            if (end + 8 > input.length) throw new Error('Incomplete GRep frame.');
            end += 24 + view.getUint32(end + 4, true);
            if (end > input.length) throw new Error('Incomplete GRep block.');
            if (end - begin < initialGeometryBatchBytes && end !== input.length) continue;
            for (let pending; (pending = Atomics.load(parameterPriority, 0)) > 0; ) {
              yields++;
              const turn = pendingParameterTurn(parameterPriority, pending);
              if (turn) await turn;
            }
            decodeGeometry(input.subarray(begin, end));
            begin = end;
          }
          console.debug('IOExtend parameter priority yields', yields);
        } else if (geometry) decodeGeometry(input);
        else append(Program.DecodeParameterBatch(input));
        if (omittedBytes) console.debug('IOExtend geometry arena deferred bytes', omittedBytes);
        Atomics.store(status, 1, localHeapViewU8().byteLength);
        Atomics.store(status, 0, length + 1);
      } catch (error) {
        console.warn('IOExtend decoder worker', error);
        Atomics.store(status, 0, -1);
      } finally {
        if (queuedParameters) releaseParameterPriority(parameterPriority);
        Atomics.notify(status, 0, 1);
      }
    };
    self.postMessage({ ready: true });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
}

function decoderMailboxes(pool, capacity) {
  return pool.map((worker) => {
    const mailbox = new SharedArrayBuffer(8 + capacity);
    return { worker, mailbox, status: new Int32Array(mailbox, 0, 2), data: new Uint8Array(mailbox, 8) };
  });
}

function appendGeometryResults(arena, encoded) {
  const cursor = new Int32Array(arena, 0, 1);
  const output = new Uint8Array(arena, 4);
  function append(bytes) {
    let begin = Atomics.load(cursor, 0);
    while (bytes.length <= output.length - begin) {
      const previous = Atomics.compareExchange(cursor, 0, begin, begin + bytes.length);
      if (previous === begin) {
        output.set(bytes, begin);
        return bytes.length;
      }
      begin = previous;
    }
    return 0;
  }

  if (append(encoded) === encoded.length) return encoded.length;

  // Preserve complete records. The original decoder applies them by index and replays missing ones.
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  let retained = 0;
  for (let offset = 0; offset < encoded.length; ) {
    if (offset + 8 > encoded.length) throw new Error('Incomplete geometry result header.');
    const length = view.getInt32(offset + 4, true);
    const end = offset + 8 + Math.max(0, length);
    if (length < -1 || end > encoded.length) throw new Error('Invalid geometry result length.');
    retained += append(encoded.subarray(offset, end));
    offset = end;
  }
  return retained;
}

function recoveryWork(inputs) {
  const length = inputs.reduce((sum, data) => sum + data.length, 0);
  const target = Math.max(32 * 1024, Math.ceil(length / 12));
  const input = new Uint8Array(new SharedArrayBuffer(length));
  const ends = [0];
  let start = 0;
  for (const data of inputs) {
    input.set(data, start);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let offset = 0; offset < data.length; ) {
      if (offset + 24 > data.length) throw new Error('Incomplete geometry frame header.');
      offset += 24 + view.getUint32(offset + 4, true);
      if (offset > data.length) throw new Error('Incomplete geometry frame payload.');
      if (start + offset - ends[ends.length - 1] >= target) ends.push(start + offset);
    }
    start += data.length;
  }
  if (ends[ends.length - 1] < length) ends.push(length);
  return { next: new Int32Array(new SharedArrayBuffer(4)), input, ends };
}

const inflateBudget = 32 * 1024 * 1024;

function planPartitionInflation(input) {
  if (input.length < 4 || input.length > inflateBudget) throw new Error('Invalid partition gzip packet.');
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const count = view.getUint32(0, true);
  if (count < 2 || count > 128 || 4 + 4 * count > input.length) throw new Error('Invalid gzip member count.');
  const jobs = [];
  let start = 4 + 4 * count,
    outputStart = 0;
  for (let i = 0; i < count; i++) {
    const length = view.getUint32(4 + 4 * i, true);
    const end = start + length;
    if (length < 18 || end > input.length) throw new Error('Invalid gzip member bounds.');
    const outputEnd = outputStart + view.getUint32(end - 4, true);
    if (outputEnd > inflateBudget) throw new Error('Partition gzip output exceeds the batch budget.');
    jobs.push({ start, end, outputStart, outputEnd });
    start = end;
    outputStart = outputEnd;
  }
  if (start !== input.length || outputStart === 0) throw new Error('Invalid partition gzip packet length.');
  return { jobs, outputLength: outputStart };
}

async function inflatePartitionMember(source, job, output) {
  let position = job.start;
  const input = new ReadableStream({
    pull(controller) {
      if (position === job.end) {
        controller.close();
        return;
      }
      const next = Math.min(position + 8 * 1024, job.end);
      controller.enqueue(source.slice(position, next));
      position = next;
    },
  });
  const reader = input.pipeThrough(new DecompressionStream('gzip')).getReader();
  let offset = job.outputStart;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length > job.outputEnd - offset) {
        await reader.cancel();
        throw new Error('Partition gzip member exceeds its declared length.');
      }
      output.set(value, offset);
      offset += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== job.outputEnd) throw new Error('Partition gzip member length differs.');
}

function indexR22Jobs(sourceLength, plan) {
  const view = new DataView(plan.buffer, plan.byteOffset, plan.byteLength);
  if (plan.length < 4) throw new Error('Missing R22 range count.');
  const count = view.getUint32(0, true);
  if (!count || count > (plan.length - 4) / 24) throw new Error('Invalid R22 range count.');
  const jobs = [];
  let previousEnd = 0,
    at = 4;
  for (let i = 0; i < count; i++) {
    if (plan.length - at < 12) throw new Error('Incomplete R22 range header.');
    const start = view.getUint32(at, true);
    const length = view.getUint32(at + 4, true);
    const items = view.getUint32(at + 8, true);
    const first = at + 12;
    const end = start + length,
      last = first + 12 * items;
    if (!length || !items || start !== previousEnd || end > sourceLength || last > plan.length)
      throw new Error('Invalid R22 range boundary.');
    jobs.push({ start, end, first, last });
    previousEnd = end;
    at = last;
  }
  if (at !== plan.length) throw new Error('Unexpected R22 range data.');
  return jobs;
}

function dispatchRecoveryBatch(mailboxes, work, arena) {
  for (const { status, worker, mailbox } of mailboxes) {
    Atomics.store(status, 0, work.ends.length > 1 ? 0 : 1);
    if (work.ends.length > 1) worker.postMessage({ mailbox, work, arena });
  }
}

function pendingParameterTurn(priority, pending) {
  if (typeof Atomics.waitAsync !== 'function') return new Promise((resolve) => setTimeout(resolve, 0));
  const waiting = Atomics.waitAsync(priority, 0, pending);
  return waiting.async ? waiting.value : undefined;
}

function releaseParameterPriority(priority) {
  if (Atomics.sub(priority, 0, 1) === 1) Atomics.notify(priority, 0, 1);
}

function postDecoderShard(worker, message) {
  const parameterPriority = worker.parameterPriority;
  const queuedParameters = !message.geometry;
  if (queuedParameters) Atomics.add(parameterPriority, 0, 1);
  try {
    worker.postMessage({ ...message, parameterPriority, queuedParameters });
  } catch (error) {
    if (queuedParameters) releaseParameterPriority(parameterPriority);
    throw error;
  }
}

function dispatchBatch(mailboxes, inputs, geometry, yieldDecode, arena) {
  for (let i = 0; i < mailboxes.length; i++) {
    const { status, worker, mailbox } = mailboxes[i];
    Atomics.store(status, 0, inputs[i].length ? 0 : 1);
    if (inputs[i].length) postDecoderShard(worker, { input: inputs[i], mailbox, geometry, yieldDecode, arena });
  }
}

function waitBatch(mailboxes, deadline = performance.now() + 20_000) {
  const sizes = [];
  let timedOut = false;
  for (const { status } of mailboxes) {
    const waited = Atomics.wait(status, 0, 0, Math.max(0, deadline - performance.now()));
    timedOut ||= waited === 'timed-out';
    sizes.push(Atomics.load(status, 0) - 1);
  }
  if (timedOut || sizes.some((size) => size < 0)) {
    console.warn('IOExtend decoder batch will replay locally', sizes);
    if (timedOut) mailboxes.forEach(({ worker }) => worker.terminate());
    return { sizes: null, mailboxes, length: 4, timedOut };
  }
  return { sizes, mailboxes, length: sizes.reduce((total, size) => total + size + 4, 0), timedOut };
}

function writeBatch(batch, destination) {
  const { sizes, mailboxes, length } = batch;
  if (destination.length !== length) throw new Error('Decoder output length changed.');
  const header = new Uint8Array(4);
  const view = new DataView(header.buffer);
  if (batch.arena) {
    view.setInt32(0, batch.arena.length, true);
    destination.set(header, 0);
    destination.set(batch.arena, 4);
    view.setInt32(0, 0, true);
    for (let offset = batch.arena.length + 4; offset < destination.length; offset += 4)
      destination.set(header, offset);
    return;
  }
  if (!sizes) {
    view.setInt32(0, -1, true);
    destination.set(header, 0);
    return;
  }
  let pos = 0;
  for (let i = 0; i < mailboxes.length; i++) {
    const size = sizes[i];
    view.setInt32(0, size, true);
    destination.set(header, pos);
    pos += 4;
    destination.set(mailboxes[i].data.subarray(0, size), pos);
    pos += size;
  }
}

export function startDecoder(dotnet, { role }) {
  {
    const binary = new Promise((resolve, reject) => {
      self.onmessage = ({ data: { wasmBlob } }) =>
        wasmBlob instanceof Blob ? resolve(wasmBlob) : reject(new Error('Missing worker runtime binary.'));
    });
    dotnet.withResourceLoader((type) =>
      type === 'dotnetwasm'
        ? binary.then((blob) => new Response(blob, { headers: { 'Content-Type': 'application/wasm' } }))
        : null
    );
  }
  return startParameterWorker(dotnet, role);
}

export function createDecoders(dotnet) {
  let localHeapViewU8;
  const parameterPool = [];
  let wasmBlob, nameWorker, nameReady, nameStatus, nameOutput;
  let parameterPoolDisabled = false;
  let retiredDecoders;
  const channels = new Map();
  const geometryArenas = new Map();
  const busyChannels = new Set();
  function start(channel, inputs) {
    const yieldDecode = channel === 2;
    const recovery = channel === 1 || channel === 3;
    if (channel === 2) channel = 3;
    if (parameterPoolDisabled || retiredDecoders) return;
    if (busyChannels.has(channel)) throw new Error('Decoder channel already in use.');
    const parameters = channel === 0 || channel === 4;
    let mailboxes = channels.get(channel);
    if (!mailboxes) {
      const capacity = shardCapacity;
      if (!parameters) geometryArenas.set(channel, new SharedArrayBuffer(4 + capacity * parameterPool.length));
      channels.set(
        channel,
        (mailboxes = decoderMailboxes(parameterPool, geometryArenas.has(channel) ? 0 : capacity))
      );
    }
    const arena = geometryArenas.get(channel);
    if (arena) Atomics.store(new Int32Array(arena, 0, 1), 0, 0);
    if (recovery) {
      dispatchRecoveryBatch(mailboxes, recoveryWork(inputs), arena);
    } else dispatchBatch(mailboxes, inputs, !parameters, yieldDecode, arena);
    busyChannels.add(channel);
  }
  function getReadyBatch(channel) {
    if (channel === 2) channel = 3;
    const mailboxes = channels.get(channel);
    if (!busyChannels.delete(channel)) return { sizes: null, length: 4 };
    const batch = waitBatch(mailboxes);
    const parameters = channel === 0 || channel === 4;
    if (!parameters && batch.sizes) {
      const arena = geometryArenas.get(channel);
      if (arena) {
        const length = Atomics.load(new Int32Array(arena, 0, 1), 0);
        if (batch.length !== length + 16) throw new Error('Geometry arena length differs.');
        batch.arena = new Uint8Array(arena, 4, length);
      }
    }
    if (batch.timedOut) {
      parameterPoolDisabled = true;
      busyChannels.clear();
    }
    return batch;
  }
  function collect(channel) {
    const batch = getReadyBatch(channel);
    const result = new Uint8Array(batch.length);
    writeBatch(batch, result);
    return result;
  }
  function decoderMailboxBytes() {
    let bytes = 0;
    for (const mailboxes of channels.values()) for (const { data } of mailboxes) bytes += data.byteLength;
    for (const arena of geometryArenas.values()) bytes += arena.byteLength - 4;
    return bytes;
  }
  function retireIdleDecoders() {
    if (!parameterPool.length || parameterPoolDisabled || busyChannels.size) return;
    retiredDecoders = { workers: parameterPool.length, mailboxBytes: decoderMailboxBytes() };
    for (const worker of parameterPool) worker.terminate();
    parameterPool.length = 0;
    channels.clear();
    geometryArenas.clear();
    console.debug('IOExtend retired decoders', JSON.stringify(retiredDecoders));
  }
  let share, fail;
  wasmBlob = new Promise((resolve, reject) => {
    share = resolve;
    fail = reject;
  });
  dotnet.withResourceLoader((type, name, url, integrity) => {
    if (type !== 'dotnetwasm') return null;
    const download = fetch(url, { integrity }).then((response) => {
      if (!response.ok) throw new Error('WASM download failed: ' + response.status);
      response.clone().blob().then(share, fail);
      return response;
    });
    download.catch(fail);
    return download;
  });
  for (let i = 0; i < 4; i++) parameterPool.push(createParameterWorker(undefined, wasmBlob));
  nameWorker = createParameterWorker('names', wasmBlob);
  if (nameWorker) {
    nameReady = nameWorker.startup.then(
      () => true,
      (error) => {
        console.warn('IOExtend name worker startup', error);
        return false;
      }
    );
  }

  const workersReady = Promise.allSettled(
    parameterPool.map(async (worker, index) => {
      try {
        await worker.startup;
      } catch (error) {
        console.warn('IOExtend retrying parameter worker startup', index, error);
        worker.terminate();
        const replacement = createParameterWorker(undefined, wasmBlob);
        parameterPool[index] = replacement;
        await replacement.startup;
      }
    })
  ).then((outcomes) => {
    const failure = outcomes.find((result) => result.status === 'rejected');
    if (failure) console.warn('IOExtend parameter worker setup failed', failure.reason);
    return outcomes.length > 0 && !failure;
  });
  dotnet.withEnvironmentVariable('IOEXTEND_PROBE_COPY_CONTROL', '1');
  dotnet.withEnvironmentVariable('IOEXTEND_PROBE_GUID_SEARCH', '2');
  dotnet.withEnvironmentVariable('IOEXTEND_PROBE_RECOVERY_BATCH_MIB', '4');
  dotnet.withEnvironmentVariable('IOEXTEND_PROBE_DIRECT_TRIM', '1');
  dotnet.withEnvironmentVariable('IOEXTEND_PROBE_SKIP_RESOLVED_PARAMETERS', '1');
  dotnet.withEnvironmentVariable('IOEXTEND_PROBE_CAPTIONS_DURING_GEOMETRY', '1');
  dotnet.withEnvironmentVariable('IOEXTEND_PROBE_FUSED_PLACEMENT_BOUNDS', '1');
  dotnet.withEnvironmentVariable('IOEXTEND_PROBE_REUSE_CONTAINED_PLACEMENT', '1');
  dotnet.withEnvironmentVariable('IOEXTEND_PROBE_DEFER_PLACED_FACES', '1');
  function sendNameMessage(kind, input, fields) {
    if (
      !(input.buffer instanceof ArrayBuffer) ||
      input.buffer === localHeapViewU8().buffer ||
      input.byteOffset !== 0 ||
      input.byteLength !== input.buffer.byteLength
    )
      input = input.slice();
    nameWorker.postMessage({ kind, input, ...fields }, [input.buffer]);
  }

  const imports = {
    inflatePartitionMembers(input) {
      if (parameterPoolDisabled || retiredDecoders) return new Uint8Array();
      const started = performance.now();
      try {
        const { jobs, outputLength } = planPartitionInflation(input);
        const source = new Uint8Array(new SharedArrayBuffer(input.length));
        source.set(input);
        const output = new Uint8Array(new SharedArrayBuffer(outputLength));
        const claim = new Int32Array(new SharedArrayBuffer(4));
        const workers = decoderMailboxes(parameterPool, 0);
        const inflate = { source, output, claim, jobs };
        for (const { worker, mailbox } of workers) worker.postMessage({ mailbox, inflate });
        const batch = waitBatch(workers);
        if (batch.timedOut) parameterPoolDisabled = true;
        if (!batch.sizes || batch.length !== outputLength + workers.length * 4) {
          console.warn('IOExtend browser inflate fallback');
          return new Uint8Array();
        }
        const result = output.slice();
        console.debug(
          'IOExtend browser inflate',
          jobs.length,
          input.length,
          result.length,
          Math.round(performance.now() - started)
        );
        return result;
      } catch (error) {
        console.warn('IOExtend browser inflate fallback', String(error));
        return new Uint8Array();
      }
    },
    rewriteR22Ranges(schema, width, trackIds, input, plan) {
      if (parameterPoolDisabled || retiredDecoders) return new Uint8Array();
      const started = performance.now();
      const jobs = indexR22Jobs(input.length, plan);
      const source = new Uint8Array(new SharedArrayBuffer(input.length));
      source.set(input);
      const schemaData = new Uint8Array(new SharedArrayBuffer(schema.length));
      schemaData.set(schema);
      const sharedPlan = new Uint8Array(new SharedArrayBuffer(plan.length));
      sharedPlan.set(plan);
      const capacity = Math.min(192 * 1024 * 1024, 2 * input.length);
      const arena = new SharedArrayBuffer(4 + capacity);
      const result = { cursor: new Int32Array(arena, 0, 1), data: new Uint8Array(arena, 4) };
      const claim = new Int32Array(new SharedArrayBuffer(4));
      const workers = decoderMailboxes(parameterPool, 0);
      const transcode = { schema: schemaData, width, trackIds, source, plan: sharedPlan, jobs, claim, result };
      for (const { worker, mailbox } of workers) worker.postMessage({ mailbox, transcode });
      const batch = waitBatch(workers);
      if (batch.timedOut) parameterPoolDisabled = true;
      if (!batch.sizes) return new Uint8Array();
      const length = Atomics.load(result.cursor, 0);
      if (length > capacity || length !== batch.length - workers.length * 4) return new Uint8Array();
      console.debug(
        'IOExtend R22 browser ranges',
        jobs.length,
        input.length,
        length,
        Math.round(performance.now() - started)
      );
      return result.data.slice(0, length);
    },
    beginNameScan(ids, culture) {
      const mailbox = new SharedArrayBuffer(8 + namesCapacity);
      nameStatus = new Int32Array(mailbox, 0, 2);
      nameOutput = new Uint8Array(mailbox, 8);
      sendNameMessage('begin', ids, { mailbox, culture });
      return true;
    },
    sendNameChunk(index, input) {
      sendNameMessage('chunk', input, { index });
    },
    sealNameScan() {
      nameWorker.postMessage({ kind: 'finish' });
    },
    collectNameScan() {
      const start = performance.now();
      const waited = Atomics.wait(nameStatus, 0, 0, 15_000);
      const code = Atomics.load(nameStatus, 0);
      const buffer = waited === 'timed-out' || code <= 0 ? new Uint8Array() : nameOutput.slice(0, code - 1);
      console.debug(
        'IOExtend name wait',
        performance.now() - start,
        buffer.length,
        Atomics.load(nameStatus, 1),
        namesCapacity
      );
      nameWorker.terminate();
      nameWorker = nameStatus = nameOutput = undefined;
      return buffer;
    },
    startDecoderBatch(channel, ...inputs) {
      start(channel, inputs);
    },
    collectDecoderBatch(channel) {
      return collect(channel);
    },
    decodeGeometryBatches(...inputs) {
      const started = performance.now();
      start(1, inputs);
      const result = collect(1);
      console.debug('IOExtend geometry mailbox', performance.now() - started, result.length);
      return result;
    },
    decodeParameterBatches(...inputs) {
      if (parameterPoolDisabled || retiredDecoders) return new Uint8Array([255, 255, 255, 255]);
      start(0, inputs);
      return collect(0);
    },
  };
  async function connect(Program, heapView) {
    localHeapViewU8 = heapView;
    if (await workersReady) {
      Program.SetParameterWorkers();
      Program.EnableBrowserR22Ranges();
      if (typeof DecompressionStream === 'function') Program.EnableBrowserPartitionInflate();
    }
    if (await nameReady) Program.SetNameScanner();
  }
  function close() {
    nameWorker?.terminate();
    for (const worker of parameterPool) worker.terminate();
  }
  return { imports, connect, retireIdleDecoders, close };
}
