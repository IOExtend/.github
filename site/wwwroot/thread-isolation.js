self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

const scope = new URL(self.registration.scope);
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (!['GET', 'HEAD'].includes(request.method) || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname))
    return;

  event.respondWith(fetch(request).then(response => {
    if (!response.ok || response.redirected) return response;
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    if (url.pathname.endsWith('.mjs')) headers.set('Content-Type', 'text/javascript');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }));
});
