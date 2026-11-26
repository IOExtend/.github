const growth = 4 * 1024 * 1024;

export function bufferScratchFile(file, budget) {
  if (!budget || typeof ArrayBuffer.prototype.resize !== 'function' ||
      typeof ArrayBuffer.prototype.transferToFixedLength !== 'function') return file;

  let buffer;
  try {
    buffer = new ArrayBuffer(0, { maxByteLength: budget.available });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return file;
  }
  let size = 0;

  function resize(length) {
    const delta = length - buffer.byteLength;
    buffer.resize(length);
    budget.available -= delta;
  }

  function commit() {
    if (!buffer) return;
    const capacity = buffer.byteLength;
    // OPFS writes require a view backed by a fixed-length buffer.
    const bytes = new Uint8Array(buffer.transferToFixedLength(size));
    buffer = undefined;
    budget.available += capacity;
    for (let at = 0; at < size;) {
      const written = file.write(bytes.subarray(at), { at });
      if (written <= 0) throw new Error('view.scratchFailed');
      at += written;
    }
  }

  return {
    read(destination, { at }) {
      if (!buffer) return file.read(destination, { at });
      const count = Math.min(destination.byteLength, Math.max(0, size - at));
      if (count) destination.set(new Uint8Array(buffer, at, count));
      return count;
    },
    write(source, { at }) {
      const end = at + source.byteLength;
      if (buffer && end > buffer.byteLength) {
        const limit = Math.min(buffer.maxByteLength, buffer.byteLength + budget.available);
        if (end > limit) commit();
        else {
          try {
            resize(Math.min(limit, Math.ceil(end / growth) * growth));
          } catch (error) {
            if (!(error instanceof RangeError)) throw error;
            commit();
          }
        }
      }
      if (!buffer) return file.write(source, { at });
      new Uint8Array(buffer, at, source.byteLength).set(source);
      size = Math.max(size, end);
      return source.byteLength;
    },
    truncate(length) {
      if (!buffer || length !== 0) {
        commit();
        file.truncate(length);
        return;
      }
      resize(0);
      size = 0;
    },
    commit,
    close() {
      if (buffer) {
        budget.available += buffer.byteLength;
        buffer = undefined;
      }
      file.close();
    },
  };
}
