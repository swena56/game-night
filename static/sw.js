// Game Night service worker: network first, so a running server always serves the newest files, with
// the last good copy of the app shell as a fallback when the network is slow (1.5 s) or gone. The API
// (/api/…, including the live event stream) is never cached.
const CACHE = 'game-night-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const key = url.pathname === '/' || url.pathname === '/index.html' ? '/' : url.pathname;  // ?room=… pages share the shell
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const fresh = fetch(e.request).then((res) => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    const slow = new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      const res = await Promise.race([fresh, slow.then(() => cache.match(key)).then((hit) => hit || fresh)]);
      return res || fresh;
    } catch {
      return (await cache.match(key)) || Response.error();
    }
  })());
});
