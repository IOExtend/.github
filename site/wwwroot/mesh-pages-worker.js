import { buildLocalMeshPackage } from './paged-storage.js';

self.onmessage = async ({ data: { scratchDirectory, triangles } }) => {
  try {
    await scratchDirectory.removeEntry('triangles');
    const source = await scratchDirectory.getFileHandle('partitions');
    const pages = await scratchDirectory.getDirectoryHandle('pages', { create: true });
    let lastUpdate = -Infinity;
    const manifest = await buildLocalMeshPackage(await source.getFile(), pages, true, ({ phase, completed, total, level }) => {
      const now = performance.now();
      if (completed > 0 && completed < total && now - lastUpdate < 500) return;
      lastUpdate = now;
      let percent = 98;
      let key;
      switch (phase) {
        case 'triangles':
          if (completed < total) percent = 97;
          key = 'view.pageTriangles';
          break;
        case 'overview':
          key = 'view.pageOverview';
          break;
        case 'properties':
          key = 'view.pageProperties';
          break;
        default:
          return;
      }
      self.postMessage({ progress: { percent, key, completed, total, level } });
    });
    if (manifest.triangles !== triangles)
      throw new Error('view.badTriangles');
    await scratchDirectory.removeEntry('partitions');
    const files = Object.create(null);
    for await (const [name, handle] of pages.entries())
      files[name] = await handle.getFile();
    self.postMessage({ files, pages: manifest.pages.length, triangles });
  } catch (error) {
    const detail = error.name === 'QuotaExceededError' || /no space available/i.test(error.message)
      ? 'view.pageStorage' : error.message;
    self.postMessage(detail === 'view.pageStorage' || detail === 'view.badTriangles'
      ? { localized: { key: detail } } : { error: detail });
  }
};
