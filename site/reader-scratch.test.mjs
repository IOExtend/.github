import assert from 'node:assert/strict';
import test from 'node:test';
import { bufferScratchFile } from './wwwroot/reader-scratch.js';

function backingFile() {
  const bytes = new Uint8Array(32);
  let size = 0;
  return {
    bytes,
    writes: 0,
    closed: false,
    read(destination, { at }) {
      const source = bytes.subarray(at, Math.min(size, at + destination.length));
      destination.set(source);
      return source.length;
    },
    write(source, { at }) {
      assert.equal(source.buffer.resizable, false);
      this.writes++;
      const count = Math.min(2, source.length);
      bytes.set(source.subarray(0, count), at);
      size = Math.max(size, at + count);
      return count;
    },
    truncate(length) {
      bytes.fill(0, length);
      size = length;
    },
    close() { this.closed = true; },
  };
}

test('buffers random writes and commits the exact contents across partial backing writes', () => {
  const budget = { available: 8 };
  const file = backingFile();
  const scratch = bufferScratchFile(file, budget);
  assert.equal(scratch.write(Uint8Array.of(3, 4), { at: 2 }), 2);
  assert.equal(scratch.write(Uint8Array.of(9), { at: 3 }), 1);
  const output = new Uint8Array(5);
  assert.equal(scratch.read(output, { at: 0 }), 4);
  assert.deepEqual([...output], [0, 0, 3, 9, 0]);
  assert.equal(scratch.read(output, { at: 6 }), 0);
  assert.equal(file.writes, 0);

  scratch.commit();
  assert.equal(file.writes, 2);
  assert.equal(budget.available, 8);
  assert.equal(file.read(output, { at: 0 }), 4);
  assert.deepEqual([...output], [0, 0, 3, 9, 0]);
});

test('spills to the backing file when the two streams use their shared budget', () => {
  const budget = { available: 4 * 1024 * 1024 + 3 };
  const partitions = backingFile();
  const triangles = backingFile();
  const first = bufferScratchFile(partitions, budget);
  const second = bufferScratchFile(triangles, budget);
  first.write(Uint8Array.of(1), { at: 0 });
  second.write(Uint8Array.of(2), { at: 2 });
  assert.equal(budget.available, 0);
  assert.equal(second.write(Uint8Array.of(3, 4), { at: 3 }), 2);
  assert.equal(budget.available, 3);
  assert.equal(partitions.writes, 0);
  const output = new Uint8Array(5);
  assert.equal(second.read(output, { at: 0 }), 5);
  assert.deepEqual([...output], [0, 0, 2, 3, 4]);
});

test('truncating and closing discard buffered data and release the budget', () => {
  const file = backingFile();
  const budget = { available: 8 };
  const scratch = bufferScratchFile(file, budget);
  scratch.write(Uint8Array.of(1, 2), { at: 0 });
  scratch.truncate(0);
  assert.equal(budget.available, 8);
  const output = new Uint8Array(3);
  assert.equal(scratch.read(output, { at: 0 }), 0);
  scratch.write(Uint8Array.of(3), { at: 2 });
  assert.equal(scratch.read(output, { at: 0 }), 3);
  assert.deepEqual([...output], [0, 0, 3]);
  scratch.close();
  assert.equal(budget.available, 8);
  assert.equal(file.writes, 0);
  assert.equal(file.closed, true);
});

test('reports a stalled backing write and leaves the handle available for cleanup', () => {
  const file = backingFile();
  file.write = () => 0;
  const budget = { available: 8 };
  const scratch = bufferScratchFile(file, budget);
  scratch.write(Uint8Array.of(1, 2), { at: 0 });
  assert.throws(() => scratch.commit(), /view\.scratchFailed/);
  assert.equal(budget.available, 8);
  scratch.close();
  assert.equal(file.closed, true);
});
