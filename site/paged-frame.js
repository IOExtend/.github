import { openMeshPackage } from './src/stream/meshSource.js';

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

const files = await new Promise(resolve => {
  function receive(event) {
    if (event.source !== parent || event.data?.type !== 'ioviewer-pages') return;
    window.removeEventListener('message', receive);
    resolve(event.data.files);
  }
  window.addEventListener('message', receive);
  parent.postMessage({ type: 'ioviewer-page-request' }, '*');
});

try {
  globalThis.IOVIEWER_MESH_SOURCE = await openMeshPackage(name => files[name]);
  await import('./src/stream/meshLod.js');
  const view = globalThis.__ioviewerMeshLod;
  if (!view) throw new Error(document.querySelector('#ioviewer-message').textContent || 'WebGL недоступен.');
  await view.ready;
  parent.postMessage({ type: 'ioviewer-page-ready' }, '*');
} catch (error) {
  parent.postMessage({ type: 'ioviewer-page-error', error: error.message }, '*');
}
