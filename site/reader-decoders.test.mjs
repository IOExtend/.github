import assert from 'node:assert/strict';
import test from 'node:test';
import { startDecoder } from './parallel/reader-decoders.js';

function startWorker(t) {
  const previous = globalThis.self;
  const messages = [];
  globalThis.self = { postMessage: message => messages.push(message) };
  t.after(() => {
    if (previous === undefined) delete globalThis.self;
    else globalThis.self = previous;
  });
  let load, response;
  const runtime = {
    withResourceLoader(loader) { load = loader; },
    withEnvironmentVariable() {},
    async create() {
      response = await load('dotnetwasm');
      return { getConfig: () => ({}), getAssemblyExports: () => ({ Program: {} }) };
    },
  };
  const ready = startDecoder(runtime, { role: 'names' });
  return { ready, messages, load, get response() { return response; } };
}

test('decoder starts from the shared native runtime and delegates other assets to the SDK', async t => {
  const worker = startWorker(t);
  assert.equal(worker.load('assembly'), null);
  const binary = new Uint8Array([0, 97, 115, 109]);
  self.onmessage({ data: { wasmBlob: new Blob([binary]) } });
  await worker.ready;
  assert.deepEqual(worker.messages, [{ ready: true }]);
  assert.equal(worker.response.headers.get('content-type'), 'application/wasm');
  assert.deepEqual(new Uint8Array(await worker.response.arrayBuffer()), binary);
});

test('decoder reports a failed runtime transfer to its coordinator', async t => {
  const worker = startWorker(t);
  self.onmessage({ data: { wasmBlob: null } });
  await worker.ready;
  assert.match(worker.messages[0].error, /Missing worker runtime binary/);
});
