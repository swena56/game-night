// Shared three.js helpers for the 3D games (Putt Party, Hover Rally, Light Riders, Sumo Saucers,
// Spire Siege, Lucky Letters, Chess 3D).
//  - GL3.load(): loads /vendor/three.min.js once (every game used to add its own <script> tag).
//  - GL3.renderer(opts, hooks): a WebGLRenderer, or null when WebGL is missing, with
//      * adaptive resolution: the pixel ratio drops a step when frames get slow (phones, big screens)
//        and creeps back up when they're smooth again, so the game keeps its frame rate;
//        hooks.cap / hooks.min override the top and bottom of that range, and r.renderStill(scene, camera)
//        draws one frame at the top of it (not timed): for on-demand games, so the view you look at
//        between moves is always sharp even when motion runs at a lower resolution;
//      * context-loss recovery: phones throw the GPU context away when you switch apps; hooks.onLost()
//        lets the game build a new renderer instead of showing a frozen or black view.
//  - GL3.shake(camera, amount): a short camera shake for hits; GL3.tickShake(camera, dt) each frame.
(function () {
  let loading = null;
  function load() {
    if (window.THREE) return Promise.resolve(window.THREE);
    loading ||= new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = '/vendor/three.min.js';
      sc.onload = () => res(window.THREE);
      sc.onerror = () => { loading = null; rej(new Error('three.js failed to load')); };
      document.head.append(sc);
    });
    return loading;
  }

  const CAP = Math.min(window.devicePixelRatio || 1, 2);
  function renderer(opts = {}, hooks = {}) {
    const T = window.THREE;
    if (!T) return null;
    let r;
    try { r = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', ...opts }); } catch { return null; }
    if (!r.getContext()) { r.dispose(); return null; }
    const cap = hooks.cap ?? CAP, min = hooks.min ?? Math.min(1, cap) * 0.6;
    let pr = cap, shown = pr;
    r.setPixelRatio(pr);
    const use = (p) => { if (p !== shown) { shown = p; r.setPixelRatio(p); } };
    // adaptive resolution: watch the time between renders (ignore pauses: on-demand games, hidden tabs)
    let last = 0, sum = 0, n = 0, smooth = 0;
    const render = r.render.bind(r);
    r.render = (scene, camera) => {
      const now = performance.now(), dt = now - last; last = now;
      if (dt > 0 && dt < 120) { sum += dt; n++; }
      if (n >= 90) {
        const avg = sum / n; sum = 0; n = 0;
        if (avg > 24 && pr > min) { pr = Math.max(min, pr - 0.25); smooth = 0; }
        else if (avg < 17 && pr < cap && ++smooth >= 4) { pr = Math.min(cap, pr + 0.25); smooth = 0; }
      }
      use(pr);
      return render(scene, camera);
    };
    r.renderStill = (scene, camera) => { last = 0; use(cap); return render(scene, camera); };
    r.quality = () => shown;
    const canvas = r.domElement;
    const lost = (e) => {
      e.preventDefault();
      // let the game rebuild with a fresh renderer once the old one is gone
      setTimeout(() => hooks.onLost?.(), 50);
    };
    canvas.addEventListener('webglcontextlost', lost);
    const dispose = r.dispose.bind(r);
    r.dispose = () => { canvas.removeEventListener('webglcontextlost', lost); dispose(); };
    return r;
  }

  // camera shake: an offset that decays, applied on top of wherever the game put the camera
  function shake(camera, amount = 0.3) {
    if (document.body.classList.contains('calm')) return;
    camera.userData.shake = Math.max(camera.userData.shake || 0, amount);
  }
  function tickShake(camera, dt) {
    const s = camera.userData.shake;
    if (!s) return;
    const k = s * s;
    camera.position.x += (Math.random() - 0.5) * k;
    camera.position.y += (Math.random() - 0.5) * k;
    camera.position.z += (Math.random() - 0.5) * k;
    camera.userData.shake = s > 0.02 ? s * Math.exp(-dt * 7) : 0;
  }

  window.GL3 = { load, renderer, shake, tickShake };
})();
