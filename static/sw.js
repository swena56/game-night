// Game Night service worker: network first, so a running server always serves the newest files, with
// the last good copy of the app shell as a fallback when the network is slow (1.5 s) or gone. The API
// (/api/…, including the live event stream) is never cached.
const CACHE = 'game-night-v94';  // bump when the shell's files must update together (v94: pinball outlane special and ball search; v93: pinball lane change, sling cooldown, save blink; v92: pinball magnet and rubber posts; v91: pinball subway; v90: pinball scoop saucer; v89: pinball rounds 5-7 reach phones that held a cached script; style.css + kit.js; v18: picker 🃏 Cards chip #189; v19: ✨ XP card, level frames, card backs; v20: 🙈 hide games from the lists; v21: compact XP list #222; v22: Sky Drop coins, gems and mines; v23: Sky Drop hyperspace finish; v24: coin sparks; v25: slipstream; v26: Sky Drop graphics; v27: Sky Drop smoother flying; v28: Sky Drop levels, perks, warnings; v29: Sky Drop drifting rings; v30: Sky Drop blackout, slingshot, climb, flat-view motion; v31: Paint Blast bomb ghost; v32: Sky Drop round tunnel, falling feel, star hazards; v33: Star Guard rage tint; v34: Sky Drop levels 6-8: gust callouts, shutters)

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

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
