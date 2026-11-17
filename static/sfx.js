// Snd: a shared sound kit for the action games (#121 #122 #127 #133). Everything is synthesised (no files),
// built on the app's out() bus (so the volume setting and its compressor apply), with what Billiards proved
// out: one shared noise buffer, rooms made of generated impulse responses, sounds panned to where they
// happen, filtered noise bursts (with an optional sweep) and damped resonances (struck things ring at a few
// pitches and die away). Every one-shot gets a little random variation so repeats don't sound copied.
//
//   Snd.play(fn)                 fn(t, K) runs only when sound is on (prefs.sound, prefs.moves, tab shown)
//   K.at({ pan, room, send, vol }) a destination: panned (-1..1), with a send into a room
//   K.burst(dst, t, { type, f, f1, q, vol, tau, dur })   filtered noise, f→f1 sweep, decay tau
//   K.mode(dst, t, f, vol, tau, { detune, f1 })          one damped resonance (a soft onset, no click)
//   K.sweep(dst, t, { f0, f1, dur, vol, type, attack })  an oscillator sweep with a shaped envelope
//   Snd.bed(key, make)           a looping bed: make(K, dst) → { set(level, x), stop() }; Snd.bed(key).set(...)
//   Snd.stopAll()                silence every bed (a game's unmount)
// Rooms: 'room' (a small games room), 'hall' (a bowling alley), 'arena' (an ice rink), 'outdoor' (snow,
// a field: a dry slap off the far side and little else).
//
// (Never name a helper here out, sfx, tone or noise: they're the app's globals, #104.)
window.Snd = (() => {
  let A = null, dry = null, nbuf = null, brown = null;
  const rooms = {}, beds = {};
  const R = (a, b) => a + Math.random() * (b - a);
  const vary = (x, amt = 0.04) => x * (1 + (Math.random() * 2 - 1) * amt);

  function on() {
    return typeof prefs !== 'undefined' && prefs.sound && prefs.moves && !document.hidden && typeof window.out === 'function';
  }
  function ctx() {
    const o = window.out();
    if (A && A === o.context) { if (A.state === 'suspended') A.resume(); return A; }
    A = o.context;
    if (A.state === 'suspended') A.resume();
    const sr = A.sampleRate;
    dry = A.createDynamicsCompressor();
    dry.threshold.value = -14; dry.knee.value = 8; dry.ratio.value = 3.5; dry.attack.value = 0.002; dry.release.value = 0.14;
    dry.connect(o);
    nbuf = A.createBuffer(1, sr * 2, sr);
    const d = nbuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    brown = A.createBuffer(1, sr * 2, sr);
    const b = brown.getChannelData(0);
    for (let i = 0, lp = 0; i < b.length; i++) { lp += 0.06 * ((Math.random() * 2 - 1) - lp); b[i] = lp * 3.4; }
    for (const k in rooms) delete rooms[k];
    return A;
  }
  // a room's impulse response: early reflections off the walls, then a tail that loses its highs as it dies
  const ROOMS = {
    room: { len: 0.45, tau: 0.075, damp: 3, early: [[7, 0.5], [11, 0.35], [17, 0.3], [23, 0.2], [31, 0.15]], wet: 0.3 },
    hall: { len: 1.6, tau: 0.32, damp: 1.6, early: [[13, 0.45], [21, 0.35], [34, 0.3], [47, 0.22], [62, 0.18], [80, 0.12]], wet: 0.34 },
    arena: { len: 2.2, tau: 0.5, damp: 0.9, early: [[25, 0.35], [41, 0.3], [66, 0.22], [95, 0.16]], wet: 0.3 },
    outdoor: { len: 0.6, tau: 0.03, damp: 4, early: [[90, 0.22], [140, 0.1]], wet: 0.22 },
  };
  function room(name) {
    if (rooms[name]) return rooms[name];
    const p = ROOMS[name] || ROOMS.room, sr = A.sampleRate, len = Math.floor(sr * p.len), ir = A.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const s = i / sr, k = Math.min(0.94, 0.2 + s * p.damp);
        lp += (1 - k) * ((Math.random() * 2 - 1) - lp);
        d[i] = s < 0.01 ? 0 : lp * Math.exp(-s / p.tau) * 1.6;
      }
      for (const [ms, a] of p.early) { const j = Math.floor(sr * (ms + ch * 1.7) / 1000); if (j < len) d[j] += a * (ch ? -1 : 1); }
    }
    const cv = A.createConvolver(), wet = A.createGain();
    cv.buffer = ir; wet.gain.value = p.wet;
    cv.connect(wet).connect(dry);
    return (rooms[name] = cv);
  }
  // a destination: a gain, panned, feeding the dry bus and (send > 0) a room
  function at({ pan = 0, room: rm = 'room', send = 0.8, vol = 1 } = {}) {
    const g = A.createGain();
    g.gain.value = vol;
    let head = g;
    if (A.createStereoPanner) { const p = A.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); head = p; }
    head.connect(dry);
    if (send > 0 && rm) { const s = A.createGain(); s.gain.value = send; head.connect(s).connect(room(rm)); }
    return g;
  }
  function burst(dst, t, { type = 'bandpass', f = 1000, f1 = 0, q = 0.8, vol = 0.3, tau = 0.02, dur = 0, buf = null, attack = 0 } = {}) {
    const s = A.createBufferSource(), fl = A.createBiquadFilter(), g = A.createGain();
    s.buffer = buf === 'brown' ? brown : nbuf; fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(vary(f, 0.06), t);
    const end = dur || tau * 7;
    if (f1) fl.frequency.exponentialRampToValueAtTime(Math.max(20, vary(f1, 0.06)), t + end);
    const v = vary(vol, 0.12);
    if (attack) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + attack); } else g.gain.setValueAtTime(v, t);
    if (dur) { g.gain.setValueAtTime(v, t + Math.max(attack, dur - tau * 3)); g.gain.setTargetAtTime(0, t + Math.max(attack, dur - tau * 3), tau); }
    else g.gain.setTargetAtTime(0, t + attack, tau);
    s.connect(fl).connect(g).connect(dst);
    s.start(t, Math.random() * 1.2); s.stop(t + end + tau * 6 + 0.02);
  }
  function mode(dst, t, f, vol, tau, { detune = 0.03, f1 = 0, type = 'sine' } = {}) {
    const o = A.createOscillator(), g = A.createGain(), ff = f * (1 + (Math.random() - 0.5) * detune);
    o.type = type; o.frequency.setValueAtTime(ff, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1 * ff / f, t + tau * 4);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vary(vol, 0.1), t + 0.0015); g.gain.setTargetAtTime(0, t + 0.0015, tau);
    o.connect(g).connect(dst); o.start(t); o.stop(t + tau * 8 + 0.02);
  }
  function sweep(dst, t, { f0 = 400, f1 = 400, dur = 0.2, vol = 0.1, type = 'sine', attack = 0.01 } = {}) {
    const o = A.createOscillator(), g = A.createGain();
    o.type = type; o.frequency.setValueAtTime(vary(f0, 0.03), t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, vary(f1, 0.03)), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vary(vol, 0.1)), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dst); o.start(t); o.stop(t + dur + 0.03);
  }
  // a looping source of noise ('white' or 'brown') for beds
  function loopSrc(kind = 'white') {
    const s = A.createBufferSource(); s.buffer = kind === 'brown' ? brown : nbuf; s.loop = true; s.start(A.currentTime, Math.random()); return s;
  }
  const K = { at, burst, mode, sweep, loopSrc, R, vary, room, get ctx() { return A; }, get dry() { return dry; } };

  function play(fn, delay = 0) {
    if (!on()) return;
    try { ctx(); fn(A.currentTime + 0.005 + delay, K); } catch {}
  }
  // a bed is created on first use, follows set(level, x) (level 0 fades it out and stops it after a while)
  function bed(key, make) {
    let b = beds[key];
    const api = {
      set(level, x) {
        if (!(level > 0) || !on()) { if (b) { try { b.set(0, x); } catch {} const mine = b; clearTimeout(mine.off); mine.off = setTimeout(() => { if (beds[key] === mine) { try { mine.stop(); } catch {} delete beds[key]; b = null; } }, 1200); } return; }
        try {
          ctx();
          if (!b && make) { b = beds[key] = make(K, at({ room: 'room', send: 0 })) || null; }
          if (!b) return;
          clearTimeout(b.off); b.off = null;
          b.set(level, x);
        } catch {}
      },
    };
    return api;
  }
  function stopAll() { for (const k in beds) { try { beds[k].stop(); } catch {} delete beds[k]; } }
  return { play, bed, stopAll, on, K, R, vary };
})();
