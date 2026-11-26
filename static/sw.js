// Game Night service worker: network first, so a running server always serves the newest files, with
// the last good copy of the app shell as a fallback when the network is slow (1.5 s) or gone. The API
// (/api/…, including the live event stream) is never cached.
const CACHE = 'game-night-v139';  // bump when the shell's files must update together (v139: Rift Split lives and shield fit their tile; v138: taller Switchyard board on phones; v137: Fuse Frenzy thumb pad; v136: Prism Pop queued swaps marked on the board; v135: feedback box keyboard on phones; v134: Prism Pop standing line; v133: Sky Drop point-gain numbers; v132: pinball ramps drawn as ramps; v131: readable Rift Split power-up icons; v130: Prism Pop matching during cascades; v129: Sky Drop start briefing; v121: thick pinball lane guides that meet the flippers; v120: pinball buttons stay on screen; v119: pinball camera holds still, full width without vw; v118: pinball table fills the phone width; v117: pinball slingshot rubber animation, better posts and targets, flush lane guides; v116: Star Cadet is an official pinball table; v115: pinball ball keeps one size; v114: Check table tests every flipper shot; v113: pinball even lane guides, Star Cadet table; v112: official pinball tables play from editor spec files, editor shows the printed playfield art, decals on Golden Hour and Neon Arcade; v111: outlane lamps, cleaner orbit wire, production clones, table setup, previews, solo play buttons, ball search watchdog; v110: curated pinball tables, suggest-a-table, sandbox tables removed; v109: pinball editor on for everyone, fixes (stale group, touch palette, phone jump button, mode checkboxes); v108: seven hand-built pinball tables in the editor gallery; v107: pinball editor dev-only, ramp lock opt-in, parts list and stepping, better selection, room reuse; v106: pinball editor fits the whole board, searchable tabbed part picker; v105: pinball editor group select and duplicate, per-part play modes, 120 parts via compressed table codes; v104: pinball editor per-part points and layers; v103: pinball editor extra flippers, moving targets, rubber bands, kicker holes, point values, zoom; v102: pinball editor curved walls, one-way flaps, portals, decals, rotate/mirror/bank tools; v101: pinball empty table has rounded smooth walls; v100: pinball table editor and custom tables; v99: pinball sounds, lamps and apron card from the details list; v98: pinball flashers and bumper-cap chase; v97: pinball shot-arrow insert lamps; v96: pinball left orbit with diverter; v95: pinball attract-mode lamp chase; v94: pinball outlane special and ball search; v93: pinball lane change, sling cooldown, save blink; v92: pinball magnet and rubber posts; v91: pinball subway; v90: pinball scoop saucer; v89: pinball rounds 5-7 reach phones that held a cached script; style.css + kit.js; v18: picker 🃏 Cards chip #189; v19: ✨ XP card, level frames, card backs; v20: 🙈 hide games from the lists; v21: compact XP list #222; v22: Sky Drop coins, gems and mines; v23: Sky Drop hyperspace finish; v24: coin sparks; v25: slipstream; v26: Sky Drop graphics; v27: Sky Drop smoother flying; v28: Sky Drop levels, perks, warnings; v29: Sky Drop drifting rings; v30: Sky Drop blackout, slingshot, climb, flat-view motion; v31: Paint Blast bomb ghost; v32: Sky Drop round tunnel, falling feel, star hazards; v33: Star Guard rage tint; v34: Sky Drop levels 6-8: gust callouts, shutters)

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
