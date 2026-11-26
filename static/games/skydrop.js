// Sky Drop: a shared server-simulated descent rendered as a Three.js chase view, with a canvas fallback.
UI.skydrop = (() => {
  let S, ctx, stage, gl = null, flat = null, raf = 0, ro = null, snap = null, gotAt = 0;
  let sx = 0, sz = 0, drag = null, keys = new Set(), sentAt = 0, lastSeq = 0, flash = '', flashAt = 0;
  let keyDown, keyUp, tiltHandler = null, tiltOn = false, tiltZero = null, three = 'loading';
  const $ = (id) => document.getElementById(id);
  let hyperAt = 0, hyperRun = -1;   // (#241) when my dive ended: the hyperspace jump plays for HYPER ms before the results
  const HYPER = 1900;
  const dark = (v, d, rel) => rel > 25 && (v?.dark || []).some(([a, b]) => d > a && d < b);   // 🌑 level 5: rings and coins hide until 25 units ahead
  const V = () => S?.skydrop;
  const me = () => V()?.me ?? -1;
  const color = (i) => ctx?.player?.(V()?.seats?.[i])?.color || ['#58d7ff','#ff6b8a','#ffc857','#b68aff','#72e59b','#ff9c56'][((i%6)+6)%6];
  const name = (i) => ctx?.player?.(V()?.seats?.[i])?.name || `Diver ${i + 1}`;
  const state = (i) => V()?.flyers?.[i] || [0,0,0,0,0,0,0,0,0,0,0,0,0];

  function mount(main, side) {
    S = null; snap = null; gl = flat = null; sx = sz = sentAt = 0; drag = null; keys = new Set(); lastSeq = -1; flash = ''; tiltOn = false; tiltZero = null;
    main.innerHTML = `<div class="sd"><div class="sd-stage" id="sdStage">
      <div class="sd-hud"><b id="sdPlace">🪂 SKY DROP</b><span id="sdScore">0 pts</span><span id="sdClock"></span></div>
      <div class="sd-progress"><i id="sdProgress"></i></div><div class="sd-hyper" id="sdHyper"></div><div class="sd-banner" id="sdBanner" hidden></div>
      <div class="sd-stick" id="sdStick" hidden><i></i></div>
      <div class="sd-perks" id="sdPerks" hidden><b>🎁 Checkpoint! Pick a perk</b><div><button data-perk="magnet">🧲 Magnet</button><button data-perk="wide">⭕ Wide rings</button><button data-perk="shield">🛡️ Shield</button></div></div></div>
      <div class="sd-controls"><span class="hint" id="sdHint">Drag anywhere to steer · release to stabilize · thread the rings</span><div><button id="sdTilt">📱 Tilt</button> <button id="sdBoost" class="primary">⚡ Boost <small id="sdCharges">3</small></button></div></div></div>`;
    side.innerHTML = `<div class="panel"><h3>🪂 Sky Drop</h3><div id="sdSeats"></div><p class="hint left">Steer in two directions. Rings build your combo, dead centre pays +50%; hazards break it. Reach a checkpoint to refill boosts.</p></div>`;
    stage = $('sdStage'); stage.style.touchAction = 'none';
    stage.addEventListener('pointerdown', (e) => {
      if (drag || e.button !== 0 || e.target.closest?.('button')) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      stage.setPointerCapture?.(e.pointerId);
      steerFrom(e);
    });
    stage.addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.id) steerFrom(e); });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      $('sdStick').hidden = true;
      keySteer();
    };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(event, end);
    let boostTap = 0;
    $('sdBoost').addEventListener('pointerdown', (e) => { e.preventDefault(); boostTap = performance.now(); boost(); });
    $('sdBoost').addEventListener('click', () => { if (performance.now() - boostTap > 600) boost(); });
    $('sdTilt').addEventListener('click', toggleTilt);
    $('sdPerks').addEventListener('pointerdown', (e) => { const b = e.target.closest('[data-perk]'); if (!b) return; e.preventDefault(); e.stopPropagation(); if (S?.phase === 'playing') ctx.input({ perk: b.dataset.perk }, true); $('sdPerks').hidden = true; });
    keyDown = (e) => {
      if (e.target?.closest?.('input,textarea,select')) return;
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyW','KeyA','KeyS','KeyD'].includes(e.code)) { e.preventDefault(); keys.add(e.code); if (!drag) keySteer(); }
      else if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) boost(); }
    };
    keyUp = (e) => { if (keys.delete(e.code) && !drag) keySteer(); };
    addEventListener('keydown', keyDown); addEventListener('keyup', keyUp); addEventListener('blur', clearSteering);
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null; ro?.observe(stage);
    GL3.load().then(() => { three = 'ok'; if(stage.isConnected)revive3d(); }).catch(() => { three = 'no'; }).finally(() => { if (stage.isConnected) ensureView(); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() { clearTimeout(steerTimer); cancelAnimationFrame(raf); ro?.disconnect(); removeEventListener('blur',clearSteering); removeEventListener('keydown',keyDown); removeEventListener('keyup',keyUp); if(tiltHandler)removeEventListener('deviceorientation',tiltHandler); tiltHandler=null;tiltOn=false;tiltZero=null;gl?.dispose(); gl = flat = null; }
  function clearSteering() {
    drag = null;
    keys.clear();
    $('sdStick').hidden = true;
    setSteer(0, 0, true);
  }
  function steerFrom(e) {
    const r = stage.getBoundingClientRect(), reach=30;
    let dx=e.clientX-drag.x, dy=e.clientY-drag.y; const m0=Math.hypot(dx,dy);
    if (m0>reach) { drag.x+=dx/m0*(m0-reach); drag.y+=dy/m0*(m0-reach); dx=e.clientX-drag.x; dy=e.clientY-drag.y; }  // the stick follows your thumb, so turning back is instant
    const mag=Math.hypot(dx,dy), scale=mag>reach?reach/mag:1, dead=mag<3?0:1, x=dead*dx*scale/reach, z=dead*dy*scale/reach;
    $('sdStick').hidden = false; $('sdStick').style.left = `${drag.x-r.left}px`; $('sdStick').style.top = `${drag.y-r.top}px`;
    $('sdStick').firstElementChild.style.transform = `translate(${dx*scale}px,${dy*scale}px)`; setSteer(x,z);
  }
  function keySteer() { let x=0,z=0; for (const k of keys) { if (k==='ArrowLeft'||k==='KeyA')x--; if(k==='ArrowRight'||k==='KeyD')x++; if(k==='ArrowUp'||k==='KeyW')z--; if(k==='ArrowDown'||k==='KeyS')z++; } const n=Math.hypot(x,z)||1; setSteer(x/n,z/n,true); }
  let steerTimer=0;
  function setSteer(x,z,force=false) {
    sx=x; sz=z; if (S?.phase !== 'playing' || S.paused) return;
    const now=performance.now(), wait=33-(now-sentAt);
    clearTimeout(steerTimer); steerTimer=0;
    if (force||wait<=0) { sentAt=now; ctx.input({sx:+x.toFixed(2),sz:+z.toFixed(2)}); return; }
    steerTimer=setTimeout(()=>{ steerTimer=0; sentAt=performance.now(); if (S?.phase === 'playing' && !S.paused) ctx.input({sx:+sx.toFixed(2),sz:+sz.toFixed(2)}); },wait);  // never drop the latest position
  }
  function boost() { if (S?.phase === 'playing' && !S.paused) ctx.input({sx:+sx.toFixed(2),sz:+sz.toFixed(2),boost:true},true); }
  async function toggleTilt() {
    if (tiltOn) { tiltOn=false; tiltZero=null; if(tiltHandler)removeEventListener('deviceorientation',tiltHandler); tiltHandler=null; $('sdTilt').classList.remove('primary'); if(!drag)keySteer(); return; }
    if (!('DeviceOrientationEvent' in window)) { ctx.toast('Tilt controls are not available on this device.'); return; }
    try { if (typeof DeviceOrientationEvent.requestPermission === 'function' && await DeviceOrientationEvent.requestPermission() !== 'granted') { ctx.toast('Tilt permission was not granted.'); return; } }
    catch { ctx.toast('Tilt controls could not be enabled.'); return; }
    tiltOn=true; $('sdTilt').classList.add('primary');
    tiltHandler=(e)=>{if(drag||keys.size||!Number.isFinite(e.gamma)||!Number.isFinite(e.beta))return;if(!tiltZero)tiltZero={x:e.gamma,y:e.beta};setSteer(Math.max(-1,Math.min(1,(e.gamma-tiltZero.x)/24)),Math.max(-1,Math.min(1,(e.beta-tiltZero.y)/25)));};
    addEventListener('deviceorientation',tiltHandler);
  }

  function ensureView() {
    if (gl || flat || !stage?.isConnected) return;
    if (three === 'ok' && window.THREE) { revive3d(); return; }
    if (three === 'no') flat = makeFlat();
  }
  function revive3d(){
    GL3.revive(stage,{build:()=>{gl?.dispose();gl=make3d();flat?.dispose?.();flat=null;return gl;},flat:()=>{flat ||= makeFlat();},unflat:()=>{flat?.dispose?.();flat=null;}});
  }
  function make3d() {
    const T=THREE, scene=new T.Scene(); scene.background=new T.Color('#11132b'); scene.fog=new T.FogExp2('#11132b',.012);
    const camera=new T.PerspectiveCamera(63,1,.1,260); const renderer=GL3.renderer({antialias:true,alpha:false},{cap:1.7,min:.7,onLost:()=>revive3d()}); if(!renderer)throw Error('no renderer');
    stage.prepend(renderer.domElement);
    const world=GL3.stage(renderer,scene,{hemi:false,key:false,exposure:1.05});
    const low=window.gfxLevel?.()==='low';
    // a round soft-edged dot, shared by the glows, trails and sparks
    const dot=(()=>{const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');if(g){const r=g.createRadialGradient(32,32,0,32,32,32);r.addColorStop(0,'#fff');r.addColorStop(.35,'#ffffffaa');r.addColorStop(1,'#fff0');g.fillStyle=r;g.fillRect(0,0,64,64);}return new T.CanvasTexture(c);})();
    // tunnel wall panels: dark tiles with thin bright seams (tinted per course through the material colour)
    const panelTex=(()=>{const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');if(g){g.fillStyle='#fff';g.fillRect(0,0,128,128);g.fillStyle='#9aa6d8';g.fillRect(0,0,128,5);g.fillRect(0,0,5,128);g.fillStyle='#c9d2ff';g.fillRect(58,58,12,12);}const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(16,30);return t;})();
    const hemi=new T.HemisphereLight(0x9adfff,0x202044,1.5);scene.add(hemi);
    const key=new T.DirectionalLight(0xffe8b5,2.0); key.position.set(-7,12,12); scene.add(key);
    const shaft=new T.Group(); scene.add(shaft);
    const farGlow=new T.Sprite(new T.SpriteMaterial({map:dot,color:0x6cecff,transparent:true,opacity:.55,blending:T.AdditiveBlending,depthWrite:false,fog:false}));farGlow.scale.set(60,40,1);scene.add(farGlow);
    const wallMat=new T.MeshStandardMaterial({color:0x222b53,map:panelTex,roughness:.72,metalness:.16,side:T.DoubleSide});
    // 🥚 a round tunnel (an ellipse, like the physics wall) that rides with you; the panels scroll past so you feel the fall
    const walls=new T.Group();scene.add(walls);const tunGeo=new T.CylinderGeometry(1,1,240,48,1,true);tunGeo.rotateX(Math.PI/2);const tunnel=new T.Mesh(tunGeo,wallMat);tunnel.scale.set(9.3,6.4,1);tunnel.position.z=-90;walls.add(tunnel);
    const GRID=11,gridRings=[];
    for(let z=-2;z<20;z++){const g=new T.Mesh(new T.TorusGeometry(9,.05,4,64),new T.MeshBasicMaterial({color:0x6179c7,transparent:true,opacity:.5,blending:T.AdditiveBlending,depthWrite:false}));g.position.z=-z*GRID;g.scale.y=.69;g.userData.k=z;shaft.add(g);gridRings.push(g);}
    // speed streaks: bright dashes that rush past, so you can feel how fast you fall and how deep you are
    const NS=110,streakPos=new Float32Array(NS*6),streakSeed=[];for(let i=0;i<NS;i++){const a=Math.random()*6.283,r=2.5+Math.random()*5.5;streakSeed.push([Math.cos(a)*r*1.5,Math.sin(a)*r*.75,Math.random()*220]);}
    const streakGeo=new T.BufferGeometry();streakGeo.setAttribute('position',new T.BufferAttribute(streakPos,3));
    const streaks=new T.LineSegments(streakGeo,new T.LineBasicMaterial({color:0xaefcff,transparent:true,opacity:.55,blending:T.AdditiveBlending,depthWrite:false}));streaks.frustumCulled=false;scene.add(streaks);
    const gateMat=new T.MeshStandardMaterial({color:0x6cecff,emissive:0x159dcc,emissiveIntensity:2.8,metalness:.18,roughness:.2});
    // ✴️ a spinning four-blade star: clearly a hazard, nothing like a ring you fly through
    const starShape=new T.Shape();for(let q=0;q<8;q++){const a=q*Math.PI/4,r=q%2?.55:1.5;q?starShape.lineTo(Math.cos(a)*r,Math.sin(a)*r):starShape.moveTo(r,0);}starShape.closePath();const starGeo=new T.ExtrudeGeometry(starShape,{depth:.25,bevelEnabled:false});starGeo.translate(0,0,-.12);
    const hazardMats=[0xff576f,0xffb843,0xc477ff,0xff1f3d,0xff8a2b,0x4de6ff,0x4de6ff].map(c=>new T.MeshStandardMaterial({color:c,emissive:c,emissiveIntensity:1.3,metalness:.2,roughness:.32}));
    const streamMat=new T.MeshBasicMaterial({color:0x6cf5d5,transparent:true,opacity:.45});
    const playerMeshes=[]; const divers=new T.Group(); scene.add(divers);
    const ringMeshes=[],hazardMeshes=[],streamMeshes=[],coinMeshes=[];
    const coinGeo=new T.CylinderGeometry(.5,.5,.12,16),gemGeo=new T.OctahedronGeometry(.62),coinMat=new T.MeshStandardMaterial({color:0xffd34d,emissive:0xd89a00,emissiveIntensity:1.6,metalness:.5,roughness:.25}),gemMat=new T.MeshStandardMaterial({color:0x6ff0ff,emissive:0x00b4d8,emissiveIntensity:2.2,metalness:.2,roughness:.1});
    // A diver is a swept wing (an arrow seen from the chase camera) with a round helmet; yours also has a
    // glowing disc in your colour under it, a light trail behind and a "YOU" tag that stays in front of rings.
    const wingShape=new T.Shape();wingShape.moveTo(0,-1.05);wingShape.lineTo(1.1,.55);wingShape.lineTo(.34,.3);wingShape.lineTo(0,.62);wingShape.lineTo(-.34,.3);wingShape.lineTo(-1.1,.55);wingShape.closePath();
    const wingGeo=new T.ExtrudeGeometry(wingShape,{depth:.12,bevelEnabled:false});wingGeo.rotateX(Math.PI/2);wingGeo.translate(0,.06,0);
    const headGeo=new T.SphereGeometry(.3,14,10),haloGeo=new T.RingGeometry(1.3,1.55,40),discGeo=new T.CircleGeometry(1.3,40),trailGeo=new T.ConeGeometry(.42,2.6,10,1,true);trailGeo.rotateX(Math.PI/2);trailGeo.translate(0,0,1.75);
    function youTag(){const c=document.createElement('canvas');c.width=128;c.height=64;const g=c.getContext('2d');if(g){g.fillStyle='#ffffffee';g.beginPath();g.roundRect?g.roundRect(8,10,112,44,22):g.rect(8,10,112,44);g.fill();g.fillStyle='#17223d';g.font='900 34px system-ui,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('YOU',64,33);}
      const t=new T.CanvasTexture(c);t.encoding=T.sRGBEncoding;const sp=new T.Sprite(new T.SpriteMaterial({map:t,depthTest:false,transparent:true}));sp.scale.set(1.5,.75,1);sp.position.set(0,1.25,0);sp.renderOrder=12;return sp;}
    function makeDiver(i,mine){const col=color(i),g=new T.Group();
      const wing=new T.Mesh(wingGeo,new T.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:mine?.75:.3,roughness:.35,metalness:.1,side:T.DoubleSide}));
      const head=new T.Mesh(headGeo,new T.MeshStandardMaterial({color:mine?0xffffff:0xdfe6ff,emissive:mine?0xffffff:0x000000,emissiveIntensity:mine?.35:0,roughness:.3}));head.position.set(0,.22,-.35);const body=new T.Group();body.add(wing,head);body.rotation.x=-.7;g.add(body);   // pitched nose-down so the chase camera sees the arrow, not an edge
      if(mine){const trail=new T.Mesh(trailGeo,new T.MeshBasicMaterial({color:col,transparent:true,opacity:.28,depthWrite:false,blending:T.AdditiveBlending}));g.add(trail);g.add(youTag());
}
      else g.scale.setScalar(.8);
      return g;}
    const TL=low?0:22,trails=[];
    function makeTrail(i){const pos=new Float32Array(TL*3),col=new Float32Array(TL*3),c=new T.Color(color(i)),geo=new T.BufferGeometry();for(let k=0;k<TL;k++){const f=1-k/TL;col.set([c.r*f,c.g*f,c.b*f],k*3);}geo.setAttribute('position',new T.BufferAttribute(pos,3));geo.setAttribute('color',new T.BufferAttribute(col,3));const pts=new T.Points(geo,new T.PointsMaterial({size:i===me()?.55:.38,map:dot,vertexColors:true,transparent:true,depthWrite:false,blending:T.AdditiveBlending}));pts.frustumCulled=false;scene.add(pts);return {pts,pos,n:0};}
    function buildCourse(v){
      for(const o of [...ringMeshes,...hazardMeshes,...streamMeshes]) {o.geometry?.dispose?.(); if(o.parent)o.parent.remove(o);}
      for(const o of coinMeshes) if(o.parent)o.parent.remove(o);
      ringMeshes.length=hazardMeshes.length=streamMeshes.length=coinMeshes.length=0;
      for(const [d,x,y,k] of v?.coins||[]){const o=new T.Mesh(k?gemGeo:coinGeo,k?gemMat:coinMat);o.position.set(x,y,-d);if(!k)o.rotation.x=Math.PI/2;o.userData={depth:d,gem:!!k};scene.add(o);coinMeshes.push(o);}
      for(let i=0;i<(v?.rings||[]).length;i++){const [d,x,y,m]=v.rings[i],gold=m>1,o=new T.Mesh(new T.TorusGeometry((gold?1:.88)*(v?.ringR||2.05),.15,12,48),gateMat.clone());if(gold){o.material.color.set(0xffdd79);o.material.emissive.set(0xffae36);}o.material.emissiveIntensity=gold?3.5:2.8;o.position.set(x,y,-d);o.userData.depth=d;o.userData.gold=gold;o.userData.i=i;o.userData.bx=x;o.userData.by=y;if(!low){const gl2=new T.Sprite(new T.SpriteMaterial({map:dot,color:gold?0xffc24a:0x6cecff,transparent:true,opacity:.28,blending:T.AdditiveBlending,depthWrite:false}));gl2.scale.setScalar(gold?6.4:5.6);o.add(gl2);o.userData.glow=gl2;if(gold){const orb=new T.Points(new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(new Float32Array(18),3)),new T.PointsMaterial({size:.45,map:dot,color:0xffe9a0,transparent:true,depthWrite:false,blending:T.AdditiveBlending}));orb.frustumCulled=false;o.add(orb);o.userData.orb=orb;}}scene.add(o);ringMeshes.push(o);}
      for(const [d,x,y,k,p] of v?.hazards||[]){const g=k===0?starGeo:k===1?new T.CylinderGeometry(.82,.82,.3,12):k===3?new T.IcosahedronGeometry(1.1,1):k===4?new T.SphereGeometry(1.1,14,10):new T.OctahedronGeometry(.95),o=new T.Mesh(g,hazardMats[k]);if(!low){const h=new T.Sprite(new T.SpriteMaterial({map:dot,color:hazardMats[k].color,transparent:true,opacity:.4,blending:T.AdditiveBlending,depthWrite:false}));h.scale.setScalar(k===3?5:3.6);o.add(h);}o.position.set(x,y,-d);o.rotation.x=k===0?0:Math.PI/2;o.userData={depth:d,phase:p,kind:k,baseX:x,baseY:y};scene.add(o);hazardMeshes.push(o);if(k===4){const rail=new T.Mesh(new T.BoxGeometry(8.8,.05,.05),new T.MeshBasicMaterial({color:0xff8a2b,transparent:true,opacity:.35}));rail.position.set(x,y,-d);scene.add(rail);}}
      for(const [d,x,y,dx,dy] of v?.streams||[]){const o=new T.Mesh(new T.TorusGeometry(2.1,.035,4,32),streamMat);o.position.set(x,y,-d);scene.add(o);streamMeshes.push(o);}for(const [g0,g1,gd] of low?[]:v?.gusts||[])for(let k=0;k<16;k++){const o=new T.Mesh(new T.BoxGeometry(3.2,.04,.04),new T.MeshBasicMaterial({color:0xbfefff,transparent:true,opacity:.35,depthWrite:false}));const dd=g0+(g1-g0)*((k*0.618)%1);o.position.set(0,((k*37)%11)/11*7-3.5,-dd);o.userData={gust:gd,gx:(k*5.3)%17};scene.add(o);streamMeshes.push(o);}
      for(const m of playerMeshes){divers.remove(m);m.traverse(o=>{if(o.material){o.material.map?.dispose();o.material.dispose();}});}
      playerMeshes.length=0;for(const t of trails){scene.remove(t.pts);t.pts.geometry.dispose();t.pts.material.dispose();}trails.length=0;
      for(let i=0;i<(v?.seats||[]).length;i++){const m=makeDiver(i,i===me());divers.add(m);playerMeshes.push(m);if(TL)trails.push(makeTrail(i));}
    }
    let seed=-1,vgLast=-1;
    function resize(){const w=stage.clientWidth||320,h=stage.clientHeight||400;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
    function render(v){if(!v||!Array.isArray(v.flyers)||!Array.isArray(v.seats))return; if(seed!==v.seed){seed=v.seed;buildCourse(v);warmUp();}
      const pal=v.course==='storm'?['#241428',0xffc16f]:v.course==='aurora'?['#08263c',0x8effe8]:['#11132b',0x6cecff];const course=v.course==='storm'?1:v.course==='aurora'?2:0;let bgc=pal[0];
      if(course===1&&!low){const ph=((v.time||0)+Math.max(0,(performance.now()-gotAt)/1000))%4.3;if(ph<.18)bgc=ph<.07||ph>.11?'#6a4f78':'#241428';}
      scene.background.set(bgc);scene.fog.color.set(bgc);gateMat.color.set(pal[1]);gateMat.emissive.set(pal[1]);
      if(course===2&&!low)wallMat.color.setHSL(.47+.08*Math.sin(performance.now()/4000),.55,.24);else wallMat.color.set(course===1?0x4a2a3c:0x222b53);hemi.color.set(course===1?0xffc79a:course===2?0x9affd8:0x9adfff);farGlow.material.color.set(pal[1]);
      const idx=me(),f=sample(idx),depth=f[0],px=f[1],py=f[2];farGlow.position.set(0,0,-depth-170);
      {const sp=Math.min(1,(12.5*(1+(v.ramp||0)*depth/(v.length||720))+(((v.time||0)+Math.max(0,(performance.now()-gotAt)/1000))<(f[13]||0)?4:0))/16.5),tt=performance.now()/1000,rum=v.stage==='race'?.03+.05*sp:0;   // 🌬️ falling: wind rumble, the camera banks into your turns, and the world rushes harder the faster you drop
        camera.position.set(px*.35+Math.sin(tt*37)*rum,py*.35+3.4+Math.sin(tt*43)*rum,-depth+12);camera.lookAt(px,py,-depth-12);camera.rotation.z+=-(f[3]||0)*.012+Math.sin(tt*1.3)*.008;}
      const nowT=performance.now()/1000,boosting=((v.time||0)+Math.max(0,(performance.now()-gotAt)/1000))<(f[13]||0);
      walls.position.z=-depth;panelTex.offset.y=-depth/8;
      shaft.position.z=-(depth-depth%GRID);   // the hoops are fixed in the tunnel: they stream past you in steps of 11
      const baseK=Math.floor(depth/GRID);curDepth=depth;
      for(const o of ringMeshes){const t=o.userData.pulse?(performance.now()-o.userData.pulse)/500:1,k=t<1?1-t:0;if(k||o.userData.lit){o.scale.setScalar(1+.7*k);o.material.emissiveIntensity=(o.userData.gold?3.5:2.8)+6*k;o.userData.lit=k>0;}if(o.userData.orb&&Math.abs(o.userData.depth-depth)<70){const q=o.userData.orb.geometry.attributes.position.array;for(let j=0;j<6;j++){const a=nowT*1.8+j*1.047;q[j*3]=Math.cos(a)*2.05;q[j*3+1]=Math.sin(a)*2.05;q[j*3+2]=0;}o.userData.orb.geometry.attributes.position.needsUpdate=true;}
        if(o.userData.glow)o.userData.glow.material.opacity=.24+.1*Math.sin(nowT*3+o.userData.depth)+.5*k;}
      for(const g of gridRings){const k=g.userData.k+baseK,m=g.material;m.color.setHSL(((k*.045+nowT*.05)%1+1)%1,.75,.58);m.opacity=.18+.4*Math.max(0,1-(g.userData.k*GRID-depth%GRID)/200);}
      const hk=hyperRun===v.run&&hyperAt?Math.min(1,(performance.now()-hyperAt)/HYPER):1,hy=hk<1?hk*hk:0,len=(boosting?7:3.2+3*Math.min(1,depth/(v.length||720)))+hy*46;for(let i=0;i<NS;i++){const [sx0,sy0,z0]=streakSeed[i],rel=((z0-depth)%220+220)%220,zz=-depth-rel+12;streakPos.set([sx0,sy0,zz,sx0,sy0,zz-len],i*6);}
      streakGeo.attributes.position.needsUpdate=true;
      {const sp=Math.min(1,(12.5+(boosting?4:0))/16.5),vg=Math.max(hy,boosting?.75:.25*sp);if(Math.abs(vg-vgLast)>.02){vgLast=vg;stage.style.setProperty('--sdv',vg.toFixed(2));}}streaks.material.opacity=hy?.95:boosting?.9:.5;
      const fov=63+(boosting?9:0)+6*Math.min(1,depth/(v.length||720))+hy*62;camera.fov+=(fov-camera.fov)*.12;camera.updateProjectionMatrix();
      const pulse=1+Math.sin(performance.now()/260)*.06;
      for(let i=0;i<playerMeshes.length;i++){const a=sample(i),o=playerMeshes[i];o.position.set(a[1],a[2],-a[0]);o.visible=!a[9]||(i===me()&&hy>0&&hy<1);if(i===me()&&hy>0)o.position.z-=hy*140;o.rotation.z=-a[3]*.09;o.rotation.x=a[4]*.03;
        const tr=trails[i];if(tr){const q=tr.pos;q.copyWithin(3,0,(TL-1)*3);q[0]=o.position.x;q[1]=o.position.y+.1;q[2]=o.position.z+1.2;tr.n=Math.min(TL,tr.n+1);tr.pts.geometry.attributes.position.needsUpdate=true;tr.pts.material.opacity=a[9]?0:(boosting&&i===idx?1:.75);if(a[9]||hy>0)tr.n=0,q.fill(1e4);}
        for(const c of o.children)if(c.userData.halo)c.scale.setScalar(pulse);}
      const elapsed=(v.time||0)+Math.max(0,(performance.now()-gotAt)/1000)-(v.raceStarted||v.go||0);
      for(const o of coinMeshes){const rel=o.userData.depth-depth;o.visible=rel>0&&rel<120&&!dark(v,o.userData.depth,rel);if(o.visible){if(o.userData.gem){o.rotation.y=nowT*2.4;o.rotation.x=.4;}else o.rotation.z=nowT*3;}}
      for(const o of ringMeshes){o.visible=!dark(v,o.userData.depth,o.userData.depth-depth);const dr=v.drifts?.[o.userData.i];if(dr){o.position.x=o.userData.bx+Math.sin(elapsed*dr[3]+dr[2])*dr[0];o.position.y=o.userData.by+Math.cos(elapsed*dr[3]*.8+dr[2])*dr[1];}}
      for(const o of streamMeshes){const gu=o.userData.gust;if(gu)o.position.x=((o.userData.gx+gu*elapsed*11)%17+17)%17-8.5;}for(const o of hazardMeshes){const {baseX,baseY,phase,kind}=o.userData;o.rotation.z=elapsed*1.7+phase;if(o.children[0]){const ahead=o.userData.depth-depth,warn=ahead>0&&ahead<55?1-ahead/55:0;o.children[0].material.opacity=.3+.2*Math.sin(nowT*5+phase)+.35*warn;o.children[0].scale.setScalar((kind===3?5:3.6)*(1+warn*.9));}if(kind===2){o.position.x=baseX+Math.sin(elapsed*1.5+phase)*1.5;o.position.y=baseY+Math.cos(elapsed*1.1+phase)*1.1;}else if(kind===4){o.position.x=baseX+Math.sin(elapsed*1.9+phase)*4.4;o.position.y=baseY+Math.cos(elapsed*1.3+phase)*.6;}else if(kind>=5){o.position.x=baseX+(kind===5?1:-1)*2.4*(1+Math.sin(elapsed*1.6+phase))/2;}}
      if(spAt){const k=(performance.now()-spAt)/450;if(k>=1){spAt=0;spPts.visible=false;}else{const m=playerMeshes[me()];if(m){const q=spGeo.attributes.position.array;for(let i=0;i<SP;i++){q[i*3]=m.position.x+spDir[i][0]*k*2.4;q[i*3+1]=m.position.y+spDir[i][1]*k*2.4;q[i*3+2]=m.position.z+spDir[i][2]*k*2.4;}spGeo.attributes.position.needsUpdate=true;spPts.material.opacity=1-k;spPts.visible=true;}}}
      GL3.tickShake?.(camera,.016);renderer.render(scene,camera);
    }
    function shake(a){GL3.shake?.(camera,a);}
    // 🪙 a little burst of sparks round your diver when you grab a coin (gold) or a gem (cyan)
    const SP=low?14:36,spDir=Array.from({length:SP},()=>{const a=Math.random()*6.283,b=Math.random()*3.1416;return [Math.sin(b)*Math.cos(a),Math.cos(b),Math.sin(b)*Math.sin(a)];});
    const spGeo=new T.BufferGeometry();spGeo.setAttribute('position',new T.BufferAttribute(new Float32Array(SP*3),3));
    const spPts=new T.Points(spGeo,new T.PointsMaterial({size:.5,map:dot,color:0xffd34d,transparent:true,depthWrite:false,blending:T.AdditiveBlending}));spPts.visible=false;spPts.frustumCulled=false;scene.add(spPts);
    let spAt=0;
    // #13 compile every material before the dive: the sparkle is hidden until the first coin, and building its
    // shader then stalled the picture just as the player picked something up
    function warmUp(){const was=spPts.visible;spPts.visible=true;renderer.compile?.(scene,camera);spPts.visible=was;}
    function sparkle(gem){spAt=performance.now();spPts.material.color.setHex(gem===2?0xff4b5f:gem?0x6ff0ff:0xffd34d);}
    // (#235) threading a ring makes it flare: it swells, whitens and fades back over about half a second
    let curDepth=0;
    function pulse(){let best=null,bd=9;for(const o of ringMeshes){const d=Math.abs(o.userData.depth-curDepth);if(d<bd){bd=d;best=o;}}if(best)best.userData.pulse=performance.now();}
    resize();return {resize,render,shake,pulse,sparkle,dispose(){renderer.domElement.remove();world.dispose?.();renderer.dispose();scene.traverse(o=>{o.geometry?.dispose?.();if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose();}});}};
  }

  function makeFlat() {
    const c=document.createElement('canvas');c.className='sd-canvas';stage.append(c);const x=c.getContext('2d');if(!x)return {resize(){},render(){},dispose(){c.remove();}};
    let flare=null,curD=0;const trail=[];
    function resize(){const r=stage.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);c.width=Math.round(r.width*d);c.height=Math.round(r.height*d);c.style.width=`${r.width}px`;c.style.height=`${r.height}px`;}
    function render(v){if(!v||!Array.isArray(v.flyers)||!Array.isArray(v.seats))return;const w=c.width,h=c.height,idx=me(),f=sample(idx),g=x.createLinearGradient(0,0,0,h),top=v.course==='storm'?'#331b32':v.course==='aurora'?'#0a3448':'#151633',bottom=v.course==='storm'?'#8a4655':v.course==='aurora'?'#287e85':'#493778';g.addColorStop(0,top);g.addColorStop(1,bottom);x.fillStyle=g;x.fillRect(0,0,w,h);
      const glow=x.createRadialGradient(w*.5,h*.35,4,w*.5,h*.35,w*.72);glow.addColorStop(0,'#98efff22');glow.addColorStop(1,'#10112600');x.fillStyle=glow;x.fillRect(0,0,w,h);x.strokeStyle='#8298ff44';x.lineWidth=2;
      for(let i=0;i<13;i++){let yy=(i*h/12+(performance.now()*.04)% (h/12));x.beginPath();x.ellipse(w/2,yy,w*.42,24,0,0,Math.PI*2);x.stroke();}
      const yy=h*.68,px=w/2+f[1]*w/22,py=yy+f[2]*h/14;
      const sxw=w/22,szh=h/14,at=(d,a,b)=>{const rel=d-f[0],k=Math.max(.35,1-rel/120);return [w/2+(a-f[1])*sxw*k+f[1]*sxw,yy-rel*h/95+b*szh*k,k,rel];};
      const el=(v.time||0)+Math.max(0,(performance.now()-gotAt)/1000)-(v.raceStarted||v.go||0);
      for(const [d,a,b,k] of v?.coins||[]){const [cx,cy,s,rel]=at(d,a,b);if(rel<=0||rel>80||dark(v,d,rel))continue;x.fillStyle=k?'#6ff0ff':'#ffd34d';x.beginPath();if(k){const r=Math.max(4,.7*sxw*s);x.moveTo(cx,cy-r);x.lineTo(cx+r*.7,cy);x.lineTo(cx,cy+r);x.lineTo(cx-r*.7,cy);x.closePath();}else x.arc(cx,cy,Math.max(3,.5*sxw*s),0,Math.PI*2);x.fill();}
      for(const [d,a0,b0,k,ph] of v?.hazards||[]){const a=k===2?a0+Math.sin(el*1.5+ph)*1.5:k===4?a0+Math.sin(el*1.9+ph)*4.4:k>=5?a0+(k===5?1:-1)*2.4*(1+Math.sin(el*1.6+ph))/2:a0,b=k===2?b0+Math.cos(el*1.1+ph)*1.1:k===4?b0+Math.cos(el*1.3+ph)*.6:b0;const [hx,hy,s,rel]=at(d,a,b);if(rel<-2||rel>80)continue;x.fillStyle=x.shadowColor=['#ff576f','#ffb843','#c477ff','#ff1f3d','#ff8a2b','#4de6ff','#4de6ff'][k]||'#ff576f';x.shadowBlur=12;x.beginPath();x.arc(hx,hy,Math.max(3,(k===0?1.3:1)*sxw*s),0,Math.PI*2);x.fill();x.shadowBlur=0;}
      curD=f[0];
      for(let i=0;i<(v?.rings||[]).length;i++){const [d,a0,b0,m]=v.rings[i],dr=v.drifts?.[i],a=dr?a0+Math.sin(el*dr[3]+dr[2])*dr[0]:a0,b=dr?b0+Math.cos(el*dr[3]*.8+dr[2])*dr[1]:b0,[rx,ry,s,rel]=at(d,a,b);if(rel<-2||rel>80||dark(v,d,rel))continue;const pk=flare&&flare.d===d?Math.max(0,1-(performance.now()-flare.t)/500):0;x.shadowColor=m>1?'#ffb62e':'#4de6ff';x.shadowBlur=10+14*pk;x.strokeStyle=pk?'#ffffff':m>1?'#ffe17d':'#7df6ff';x.lineWidth=Math.max(2,4*s)*(1+1.5*pk);x.beginPath();x.ellipse(rx,ry,Math.max(4,(m>1?2.05:1.8)*sxw*s*(1+.5*pk)),(m>1?2.05:1.8)*szh*s*.45*(1+.5*pk),0,0,Math.PI*2);x.stroke();}
      x.shadowBlur=0;x.globalAlpha=.75;for(let i=0;i<v.flyers.length;i++){if(i===idx)continue;const a=sample(i);if(a[9])continue;const [ox,oy,s,rel]=at(a[0],a[1],a[2]);if(rel<-12||rel>80)continue;x.fillStyle=color(i);x.beginPath();x.arc(ox,oy,Math.max(4,8*s),0,Math.PI*2);x.fill();}
      x.globalAlpha=1;
      if(idx>=0&&v.flyers[idx]&&!f[9]){
        // a fading light trail behind you (the last few frames' positions), brighter and longer while boosting
        trail.push([px,py]);if(trail.length>(f[13]>(v.time||0)?22:14))trail.splice(0,trail.length-(f[13]>(v.time||0)?22:14));
        x.save();x.lineCap='round';for(let i=1;i<trail.length;i++){const k=i/trail.length;x.strokeStyle=color(idx);x.globalAlpha=.5*k;x.lineWidth=(2+9*k)*Math.min(2,devicePixelRatio||1);x.beginPath();x.moveTo(trail[i-1][0],trail[i-1][1]+8*(1-k));x.lineTo(trail[i][0],trail[i][1]+8*(1-k));x.stroke();}x.restore();
      }else trail.length=0;
      if(idx>=0&&v.flyers[idx]&&!f[9]){
        // your diver: a glowing disc in your colour, an outlined swept wing and a "YOU" tag
        const d=Math.min(2,devicePixelRatio||1),u=d*(1+Math.sin(performance.now()/260)*.06),col=color(idx);
        x.save();
        x.shadowColor=col;x.shadowBlur=14*d;x.fillStyle=col;x.beginPath();x.moveTo(px,py-17*d);x.lineTo(px+19*d,py+9*d);x.lineTo(px+6*d,py+5*d);x.lineTo(px,py+11*d);x.lineTo(px-6*d,py+5*d);x.lineTo(px-19*d,py+9*d);x.closePath();x.fill();
        x.shadowBlur=0;x.strokeStyle='#ffffff';x.lineWidth=2*d;x.stroke();x.fillStyle='#ffffff';x.beginPath();x.arc(px,py-4*d,3.6*d,0,Math.PI*2);x.fill();
        x.font=`900 ${12*d}px system-ui,sans-serif`;x.textAlign='center';x.textBaseline='middle';const ty=py-30*d;x.fillStyle='#ffffffee';x.beginPath();x.roundRect?x.roundRect(px-20*d,ty-9*d,40*d,18*d,9*d):x.rect(px-20*d,ty-9*d,40*d,18*d);x.fill();x.fillStyle='#17223d';x.fillText('YOU',px,ty+1);x.restore();}
    }
    function pulse(){let best=null,bd=9;for(const r of snap?.rings||[]){const d=Math.abs(r[0]-curD);if(d<bd){bd=d;best=r[0];}}if(best!=null)flare={d:best,t:performance.now()};}
    resize();return {resize,render,shake(){},pulse,dispose(){c.remove();}};
  }
  // (#242) smoother flying: the server sends ~15 snapshots a second, so the raw prediction snaps a little at each one.
  // Ease toward the prediction once per frame, with a shorter delay for the local diver.
  let frameNo=0;const smooth=[];
  function sample(i){const m=smooth[i];if(m&&m.f===frameNo)return m.v;const raw=sampleRaw(i);if(!raw||!V()?.flyers?.[i])return raw;const now=performance.now();
    if(!m||m.run!==V().run||raw[9]||Math.abs(raw[0]-m.v[0])>8){smooth[i]={f:frameNo,t:now,run:V().run,v:raw.slice()};return smooth[i].v;}
    const k=1-Math.exp(-Math.min(.05,(now-m.t)/1000)*(i===me()?30:16)),v=raw.slice();for(let j=0;j<3;j++)v[j]=m.v[j]+(raw[j]-m.v[j])*k;m.v=v;m.t=now;m.f=frameNo;return v;}
  function sampleRaw(i){const raw=state(i);if(!raw||!V()?.flyers?.[i])return raw;const dt=Math.max(0,Math.min(.13,(performance.now()-gotAt)/1000));const v=V(),serverNow=(v.time||0)+dt,boosting=serverNow<(raw[13]||0),out=raw.slice();if(!raw[9]&&v.stage==='race'){out[0]=Math.min(v.length,raw[0]+(12.5*(1+(v.ramp||0)*raw[0]/v.length)+(boosting?4:0))*dt);out[1]=raw[1]+raw[3]*dt;out[2]=raw[2]+raw[4]*dt;}return out;}
  function loop(){frameNo++;ensureView();if(S){const v=V();(gl||flat)?.render(v);renderHud(v);}raf=requestAnimationFrame(loop);}
  function renderHud(v){if(!v||!Array.isArray(v.flyers)||!Array.isArray(v.seats))return;const i0=me(),watching=!(i0>=0&&v.flyers[i0]),f=watching?(v.flyers.reduce((a,b)=>(b[0]>a[0]?b:a),state(-1))):state(i0),depth=f[0]||0;
    const place=f[10]||(1+v.flyers.filter((a,j)=>j!==i0&&(a[9]>0?a[9]<=(f[9]||Infinity):!f[9]&&a[0]>depth)).length),ord=(n)=>n+(n%100>10&&n%100<14?'th':['th','st','nd','rd'][n%10]||'th');
    $('sdPlace').textContent=v.stage==='countdown'?`🪂 Run ${v.run} · get ready`:watching?`👀 Watching only · leader ${Math.floor(depth/v.length*100)}% · play from the lobby`:`${ord(place)} · ${Math.floor(depth/v.length*100)}%`;
    $('sdScore').textContent=`${f[5]||0} pts · ${f[6]||0} rings · ×${Math.max(1,f[7]||0)}`;if(!watching)showGain(v,f[5]||0);$('sdCharges').textContent=f[8]??3;{const pk=f[14]||'';if(pk)$('sdScore').textContent+=' · '+({magnet:'🧲',wide:'⭕',shield:'🛡️'}[pk]||'');const pp=$('sdPerks');if(pp)pp.hidden=!(f[15]&&!watching&&v.stage==='race');}
    $('sdProgress').style.width=`${Math.min(100,depth/v.length*100)}%`;$('sdClock').textContent=`Run ${v.run}/${v.runs}`;
    const banner=$('sdBanner');if(v.stage==='results'&&hyperRun===v.run&&performance.now()-hyperAt<HYPER)banner.hidden=true;else if(v.stage==='results'){banner.hidden=false;banner.replaceChildren();const title=document.createElement('b');title.textContent=`Run ${v.run} complete`;banner.append(title);for(const [n,i] of v.finished.entries()){const row=document.createElement('p');row.textContent=`${n+1}. ${name(i)} · ${state(i)[5]} pts`;banner.append(row);}}else if(v.stage==='countdown')briefing(banner,v,watching);else banner.hidden=true;
    const seats=$('sdSeats');const key=JSON.stringify([v.points,v.ringTotals,v.flyers.map(a=>a[0])]);if(seats.dataset.key!==key){seats.dataset.key=key;seats.replaceChildren();v.seats.forEach((_,i)=>{const row=document.createElement('div');row.className='sd-row';const swatch=document.createElement('i');swatch.style.background=color(i);const label=document.createElement('span');label.textContent=name(i);const score=document.createElement('b');score.textContent=`${v.points[i]+(v.stage==='results'?0:state(i)[5])} pts`;const progress=document.createElement('small');progress.textContent=`${Math.floor(state(i)[0]/v.length*100)}%`;row.append(swatch,label,score,progress);seats.append(row);});}
  }
  // (#248) every change to my score floats up from the middle of the shaft, bigger for a bigger gain, and the score pill pops
  let gained=null;
  function showGain(v,score){const key=`${v.seed}:${v.run}`,was=gained;gained={key,score};if(was?.key!==key||score===was.score)return;
    const n=score-was.score,e=document.createElement('span');e.className=`sd-gain${n<0?' lost':n>=10?' big':''}`;e.textContent=n>0?`+${n}`:`−${-n}`;
    e.style.left=`${42+Math.random()*16}%`;e.setAttribute('aria-hidden','true');stage.append(e);setTimeout(()=>e.remove(),950);
    const pill=$('sdScore');pill.classList.remove('sd-bump','lost');void pill.offsetWidth;pill.classList.add('sd-bump');if(n<0)pill.classList.add('lost');}
  // (#247) the start card: which dive this is, what scores, how to steer, and the count
  function briefing(banner,v,watching){banner.hidden=false;const key=`${v.seed}:${watching}`;let card=banner.querySelector('.sd-brief');
    if(card?.dataset.key!==key){card=document.createElement('div');card.className='sd-brief';card.dataset.key=key;
      const add=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;card.append(e);};
      add('b',`Level ${v.level}${v.levelName?` · ${v.levelName}`:''}`);add('small',`Run ${v.run} of ${v.runs} · most points wins`);
      add('p','⭕ Fly through the rings. Rings in a row build a combo.');add('p','💥 Dodge hazards. A hit breaks your combo.');
      add('p',watching?'👀 You are watching this dive.':'👆 Drag to steer · ⚡ Boost for speed');add('strong','');
      banner.replaceChildren(card);}
    const count=String(Math.max(1,Math.ceil(v.go-Date.now()/1000))),big=card.lastChild;if(big.textContent!==count)big.textContent=count;}
  function render(S0, ctx0) {
    const resumed = S?.paused && !S0.paused;
    S = S0; ctx = ctx0;
    if (resumed) clearSteering();
    if (snap?.seed !== V()?.seed) lastSeq = -1;
    snap = V(); gotAt = performance.now();
    if (lastSeq < 0) events(V());
    ensureView();
  }
  function fast(data){if(data.skydrop){const old=V()||{};S={...S,skydrop:{...data.skydrop,me:old.me,seats:old.seats,coins:old.seed===data.skydrop.seed?old.coins:undefined}};snap=S.skydrop;gotAt=performance.now();ensureView();events(S.skydrop);}}
  function events(v){const evs=v?.events||[];if(lastSeq<0||evs.some(e=>e[0]<lastSeq-40)){lastSeq=evs.at(-1)?.[0]??0;return;}for(const [n,kind,i] of evs){if(n<=lastSeq)continue;lastSeq=n;if(i!==me())continue;
    if(kind==='ring'){ctx?.sfx?.('chip');ctx?.buzz?.(8);(gl||flat)?.pulse?.();}else if(kind==='hit'){gl?.sparkle?.(2);ctx?.sfx?.('thud');ctx?.buzz?.(40);(gl||flat)?.shake?.(.35);}else if(kind==='bullseye'){ctx?.sfx?.('pop');ctx?.buzz?.(15);}else if(kind==='draft'){if(typeof Kit!=='undefined')Kit.callout('🌬️ Slipstream!','cool',{ms:600});}else if(kind==='coin'){ctx?.sfx?.('tick');ctx?.buzz?.(6);gl?.sparkle?.(false);}else if(kind==='gem'){ctx?.sfx?.('pop');ctx?.buzz?.(14);gl?.sparkle?.(true);if(typeof Kit!=='undefined')Kit.callout('💎 +10','gold',{ms:600});}else if(kind==='boom'){gl?.sparkle?.(2);ctx?.sfx?.('thud');ctx?.buzz?.([60,40,90]);(gl||flat)?.shake?.(.6);if(typeof Kit!=='undefined')Kit.callout('💥 Mine! −12','bad',{ms:1000});}else if(kind==='graze'){ctx?.sfx?.('tick');ctx?.buzz?.(10);if(typeof Kit!=='undefined')Kit.callout('😮‍💨 Close call! +3','gold',{ms:700});}else if(kind==='streak'){ctx?.sfx?.('rise');ctx?.buzz?.([10,30,10]);if(typeof Kit!=='undefined')Kit.callout('🔥 Hot streak! +10','gold',{ms:800});}else if(kind==='gustl'||kind==='gustr'){ctx?.sfx?.('whoosh');if(typeof Kit!=='undefined')Kit.callout(kind==='gustr'?'💨 Gust ahead: pushes right →':'💨 Gust ahead: pushes left ←','cool',{ms:1400});}else if(kind==='boost')ctx?.sfx?.('whoosh');else if(kind==='finish'){hyperAt=performance.now();hyperRun=V()?.run;ctx?.sfx?.('whoosh');setTimeout(()=>ctx?.sfx?.('fanfare'),HYPER*.7);const h=$('sdHyper');if(h){h.classList.remove('go');void h.offsetWidth;h.classList.add('go');}}else if(kind==='checkpoint')ctx?.sfx?.('rise');else if(kind==='sling'){ctx?.sfx?.('whoosh');ctx?.buzz?.([10,20,10]);(gl||flat)?.shake?.(.2);if(typeof Kit!=='undefined')Kit.callout('🚀 Slingshot!','gold',{ms:700});}else if(kind==='perk'){ctx?.sfx?.('pop');}else if(kind==='shield'){ctx?.sfx?.('pop');ctx?.buzz?.(20);if(typeof Kit!=='undefined')Kit.callout('🛡️ Shield blocked it!','cool',{ms:900});}else if(kind==='finish')ctx?.sfx?.('fanfare');}}
  return {mount,render,fast,unmount,turnText:()=> '🪂 Dive through the rings · highest score wins'};
})();
