// Sky Drop: a shared server-simulated descent rendered as a Three.js chase view, with a canvas fallback.
UI.skydrop = (() => {
  let S, ctx, stage, gl = null, flat = null, raf = 0, ro = null, snap = null, gotAt = 0;
  let sx = 0, sz = 0, drag = null, keys = new Set(), sentAt = 0, lastSeq = 0, flash = '', flashAt = 0;
  let keyDown, keyUp, tiltHandler = null, tiltOn = false, tiltZero = null, three = 'loading';
  const $ = (id) => document.getElementById(id);
  const V = () => S?.skydrop;
  const me = () => V()?.me ?? -1;
  const color = (i) => ctx?.player?.(V()?.seats?.[i])?.color || ['#58d7ff','#ff6b8a','#ffc857','#b68aff','#72e59b','#ff9c56'][((i%6)+6)%6];
  const name = (i) => ctx?.player?.(V()?.seats?.[i])?.name || `Diver ${i + 1}`;
  const state = (i) => V()?.flyers?.[i] || [0,0,0,0,0,0,0,0,0,0,0,0,0];

  function mount(main, side) {
    S = null; snap = null; gl = flat = null; sx = sz = 0; drag = null; keys = new Set(); lastSeq = -1; flash = ''; tiltOn = false; tiltZero = null;
    main.innerHTML = `<div class="sd"><div class="sd-stage" id="sdStage">
      <div class="sd-hud"><b id="sdPlace">🪂 SKY DROP</b><span id="sdScore">0 pts</span><span id="sdClock"></span></div>
      <div class="sd-progress"><i id="sdProgress"></i></div><div class="sd-banner" id="sdBanner" hidden></div>
      <div class="sd-stick" id="sdStick" hidden><i></i></div></div>
      <div class="sd-controls"><span class="hint" id="sdHint">Drag anywhere to steer · release to stabilize · thread the rings</span><div><button id="sdTilt">📱 Tilt</button> <button id="sdBoost" class="primary">⚡ Boost <small id="sdCharges">3</small></button></div></div></div>`;
    side.innerHTML = `<div class="panel"><h3>🪂 Sky Drop</h3><div id="sdSeats"></div><p class="hint left">Steer in two directions. Rings build your combo; hazards break it. Reach a checkpoint to refill boosts.</p></div>`;
    stage = $('sdStage'); stage.style.touchAction = 'none';
    stage.addEventListener('pointerdown', (e) => { if (e.target.closest?.('button')) return; drag = {x:e.clientX,y:e.clientY}; stage.setPointerCapture?.(e.pointerId); steerFrom(e); });
    stage.addEventListener('pointermove', (e) => { if (drag) steerFrom(e); });
    const end = () => { drag = null; $('sdStick').hidden = true; keySteer(); };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
    let boostTap = 0;
    $('sdBoost').addEventListener('pointerdown', (e) => { e.preventDefault(); boostTap = performance.now(); boost(); });
    $('sdBoost').addEventListener('click', () => { if (performance.now() - boostTap > 600) boost(); });
    $('sdTilt').addEventListener('click', toggleTilt);
    keyDown = (e) => {
      if (e.target?.closest?.('input,textarea,select')) return;
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyW','KeyA','KeyS','KeyD'].includes(e.code)) { e.preventDefault(); keys.add(e.code); keySteer(); }
      else if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) boost(); }
    };
    keyUp = (e) => { if (keys.delete(e.code)) keySteer(); };
    addEventListener('keydown', keyDown); addEventListener('keyup', keyUp);
    ro = window.ResizeObserver ? new ResizeObserver(() => (gl || flat)?.resize()) : null; ro?.observe(stage);
    GL3.load().then(() => { three = 'ok'; if(stage.isConnected)revive3d(); }).catch(() => { three = 'no'; }).finally(() => { if (stage.isConnected) ensureView(); });
    raf = requestAnimationFrame(loop);
  }

  function unmount() { cancelAnimationFrame(raf); ro?.disconnect(); removeEventListener('keydown',keyDown); removeEventListener('keyup',keyUp); if(tiltHandler)removeEventListener('deviceorientation',tiltHandler); tiltHandler=null;tiltOn=false;tiltZero=null;gl?.dispose(); gl = flat = null; }
  function steerFrom(e) {
    const r = stage.getBoundingClientRect(), dx=e.clientX-drag.x, dy=e.clientY-drag.y, reach=58;
    const mag=Math.hypot(dx,dy), scale=mag>reach?reach/mag:1, x=dx*scale/reach, z=dy*scale/reach;
    $('sdStick').hidden = false; $('sdStick').style.left = `${drag.x-r.left}px`; $('sdStick').style.top = `${drag.y-r.top}px`;
    $('sdStick').firstElementChild.style.transform = `translate(${dx*scale}px,${dy*scale}px)`; setSteer(x,z);
  }
  function keySteer() { let x=0,z=0; for (const k of keys) { if (k==='ArrowLeft'||k==='KeyA')x--; if(k==='ArrowRight'||k==='KeyD')x++; if(k==='ArrowUp'||k==='KeyW')z--; if(k==='ArrowDown'||k==='KeyS')z++; } const n=Math.hypot(x,z)||1; setSteer(x/n,z/n,true); }
  function setSteer(x,z,force=false) { sx=x; sz=z; if (!S || S.phase!=='playing') return; const now=performance.now(); if(!force&&now-sentAt<45)return; sentAt=now; ctx.input({sx:+x.toFixed(2),sz:+z.toFixed(2)}); }
  function boost() { if (S?.phase==='playing') ctx.input({boost:true},true); }
  async function toggleTilt() {
    if (tiltOn) { tiltOn=false; tiltZero=null; if(tiltHandler)removeEventListener('deviceorientation',tiltHandler); tiltHandler=null; $('sdTilt').classList.remove('primary'); return; }
    if (!('DeviceOrientationEvent' in window)) { ctx.toast('Tilt controls are not available on this device.'); return; }
    try { if (typeof DeviceOrientationEvent.requestPermission === 'function' && await DeviceOrientationEvent.requestPermission() !== 'granted') { ctx.toast('Tilt permission was not granted.'); return; } }
    catch { ctx.toast('Tilt controls could not be enabled.'); return; }
    tiltOn=true; $('sdTilt').classList.add('primary');
    tiltHandler=(e)=>{if(!Number.isFinite(e.gamma)||!Number.isFinite(e.beta))return;if(!tiltZero)tiltZero={x:e.gamma,y:e.beta};setSteer(Math.max(-1,Math.min(1,(e.gamma-tiltZero.x)/24)),Math.max(-1,Math.min(1,(e.beta-tiltZero.y)/25)));};
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
    scene.add(new T.HemisphereLight(0x9adfff,0x202044,1.5));
    const key=new T.DirectionalLight(0xffe8b5,2.0); key.position.set(-7,12,12); scene.add(key);
    const shaft=new T.Group(); scene.add(shaft);
    const wallMat=new T.MeshStandardMaterial({color:0x222b53,roughness:.72,metalness:.16,side:T.DoubleSide});
    for(let side=0;side<4;side++){const m=new T.Mesh(new T.BoxGeometry(side<2?0.35:17,side<2?12:0.35,240),wallMat); if(side===0)m.position.x=-9; if(side===1)m.position.x=9; if(side===2)m.position.y=6; if(side===3)m.position.y=-6; m.position.z=-90; shaft.add(m);}
    const gridMat=new T.MeshBasicMaterial({color:0x6179c7,transparent:true,opacity:.32});
    for(let z=0;z<20;z++){const g=new T.Mesh(new T.TorusGeometry(8.7,.025,4,64),gridMat);g.position.z=-z*11;shaft.add(g);}
    const gateMat=new T.MeshStandardMaterial({color:0x6cecff,emissive:0x159dcc,emissiveIntensity:2.8,metalness:.18,roughness:.2});
    const hazardMats=[0xff576f,0xffb843,0xc477ff].map(c=>new T.MeshStandardMaterial({color:c,emissive:c,emissiveIntensity:1.3,metalness:.2,roughness:.32}));
    const streamMat=new T.MeshBasicMaterial({color:0x6cf5d5,transparent:true,opacity:.45});
    const playerMeshes=[]; const divers=new T.Group(); scene.add(divers);
    const ringMeshes=[],hazardMeshes=[],streamMeshes=[];
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
      if(mine){const halo=new T.Mesh(haloGeo,new T.MeshBasicMaterial({color:col,transparent:true,opacity:.85,side:T.DoubleSide,depthWrite:false}));halo.userData.halo=true;halo.rotation.x=-1.2;halo.position.y=-.2;g.add(halo);
        const disc=new T.Mesh(discGeo,new T.MeshBasicMaterial({color:col,transparent:true,opacity:.2,side:T.DoubleSide,depthWrite:false}));disc.rotation.x=-1.2;disc.position.y=-.21;g.add(disc);
        const trail=new T.Mesh(trailGeo,new T.MeshBasicMaterial({color:col,transparent:true,opacity:.28,depthWrite:false,blending:T.AdditiveBlending}));g.add(trail);g.add(youTag());
}
      else g.scale.setScalar(.8);
      return g;}
    function buildCourse(v){
      for(const o of [...ringMeshes,...hazardMeshes,...streamMeshes]) {o.geometry?.dispose?.(); if(o.parent)o.parent.remove(o);}
      ringMeshes.length=hazardMeshes.length=streamMeshes.length=0;
      for(let i=0;i<(v?.rings||[]).length;i++){const [d,x,y,m]=v.rings[i],gold=m>1,o=new T.Mesh(new T.TorusGeometry(gold?2.05:1.8,.15,12,48),gateMat.clone());if(gold){o.material.color.set(0xffdd79);o.material.emissive.set(0xffae36);}o.material.emissiveIntensity=gold?3.5:2.8;o.position.set(x,y,-d);o.userData.depth=d;scene.add(o);ringMeshes.push(o);}
      for(const [d,x,y,k,p] of v?.hazards||[]){const g=k===0?new T.TorusGeometry(1.3,.18,8,12):k===1?new T.CylinderGeometry(.82,.82,.3,12):new T.OctahedronGeometry(.95),o=new T.Mesh(g,hazardMats[k]);o.position.set(x,y,-d);o.rotation.x=Math.PI/2;o.userData={depth:d,phase:p,kind:k,baseX:x,baseY:y};scene.add(o);hazardMeshes.push(o);}
      for(const [d,x,y,dx,dy] of v?.streams||[]){const o=new T.Mesh(new T.TorusGeometry(2.1,.035,4,32),streamMat);o.position.set(x,y,-d);scene.add(o);streamMeshes.push(o);}
      for(const m of playerMeshes){divers.remove(m);m.traverse(o=>{if(o.material){o.material.map?.dispose();o.material.dispose();}});}
      playerMeshes.length=0;
      for(let i=0;i<(v?.seats||[]).length;i++){const m=makeDiver(i,i===me());divers.add(m);playerMeshes.push(m);}
    }
    let seed=-1;
    function resize(){const w=stage.clientWidth||320,h=stage.clientHeight||400;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
    function render(v){if(!v||!Array.isArray(v.flyers)||!Array.isArray(v.seats))return; if(seed!==v.seed){seed=v.seed;buildCourse(v);}
      const pal=v.course==='storm'?['#241428',0xffc16f]:v.course==='aurora'?['#08263c',0x8effe8]:['#11132b',0x6cecff];scene.background.set(pal[0]);scene.fog.color.set(pal[0]);gateMat.color.set(pal[1]);gateMat.emissive.set(pal[1]);
      const idx=me(),f=sample(idx),depth=f[0],px=f[1],py=f[2];
      camera.position.set(px*.35,py*.35+3.4,-depth+12);camera.lookAt(px,py,-depth-12);
      shaft.position.z=-depth;
      const pulse=1+Math.sin(performance.now()/260)*.06;
      for(let i=0;i<playerMeshes.length;i++){const a=sample(i),o=playerMeshes[i];o.position.set(a[1],a[2],-a[0]);o.visible=!a[9];o.rotation.z=-a[3]*.06;o.rotation.x=a[4]*.03;
        for(const c of o.children)if(c.userData.halo)c.scale.setScalar(pulse);}
      const elapsed=(v.time||0)+Math.max(0,(performance.now()-gotAt)/1000)-(v.raceStarted||v.go||0);
      for(const o of hazardMeshes){const {baseX,baseY,phase,kind}=o.userData;o.rotation.z=elapsed*1.7+phase;if(kind===2){o.position.x=baseX+Math.sin(elapsed*1.5+phase)*1.5;o.position.y=baseY+Math.cos(elapsed*1.1+phase)*1.1;}}
      GL3.tickShake?.(camera,.016);renderer.render(scene,camera);
    }
    function shake(a){GL3.shake?.(camera,a);}
    resize();return {resize,render,shake,dispose(){renderer.domElement.remove();world.dispose?.();renderer.dispose();scene.traverse(o=>{o.geometry?.dispose?.();if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose();}});}};
  }

  function makeFlat() {
    const c=document.createElement('canvas');c.className='sd-canvas';stage.append(c);const x=c.getContext('2d');if(!x)return {resize(){},render(){},dispose(){c.remove();}};
    function resize(){const r=stage.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);c.width=Math.round(r.width*d);c.height=Math.round(r.height*d);c.style.width=`${r.width}px`;c.style.height=`${r.height}px`;}
    function render(v){if(!v||!Array.isArray(v.flyers)||!Array.isArray(v.seats))return;const w=c.width,h=c.height,idx=me(),f=sample(idx),g=x.createLinearGradient(0,0,0,h),top=v.course==='storm'?'#331b32':v.course==='aurora'?'#0a3448':'#151633',bottom=v.course==='storm'?'#8a4655':v.course==='aurora'?'#287e85':'#493778';g.addColorStop(0,top);g.addColorStop(1,bottom);x.fillStyle=g;x.fillRect(0,0,w,h);
      const glow=x.createRadialGradient(w*.5,h*.35,4,w*.5,h*.35,w*.72);glow.addColorStop(0,'#98efff22');glow.addColorStop(1,'#10112600');x.fillStyle=glow;x.fillRect(0,0,w,h);x.strokeStyle='#8298ff44';x.lineWidth=2;
      for(let i=0;i<13;i++){let yy=(i*h/12+(performance.now()*.04)% (h/12));x.beginPath();x.ellipse(w/2,yy,w*.42,24,0,0,Math.PI*2);x.stroke();}
      const yy=h*.68,px=w/2+f[1]*w/22,py=yy+f[2]*h/14;
      const sxw=w/22,szh=h/14,at=(d,a,b)=>{const rel=d-f[0],k=Math.max(.35,1-rel/120);return [w/2+(a-f[1])*sxw*k+f[1]*sxw,yy-rel*h/95+b*szh*k,k,rel];};
      for(const [d,a,b,k] of v?.hazards||[]){const [hx,hy,s,rel]=at(d,a,b);if(rel<-2||rel>80)continue;x.fillStyle=['#ff576f','#ffb843','#c477ff'][k]||'#ff576f';x.beginPath();x.arc(hx,hy,Math.max(3,(k===0?1.3:1)*sxw*s),0,Math.PI*2);x.fill();}
      for(let i=0;i<(v?.rings||[]).length;i++){const [d,a,b,m]=v.rings[i],[rx,ry,s,rel]=at(d,a,b);if(rel<-2||rel>80)continue;x.strokeStyle=m>1?'#ffe17d':'#7df6ff';x.lineWidth=Math.max(2,4*s);x.beginPath();x.ellipse(rx,ry,Math.max(4,(m>1?2.05:1.8)*sxw*s),(m>1?2.05:1.8)*szh*s*.45,0,0,Math.PI*2);x.stroke();}
      x.globalAlpha=.75;for(let i=0;i<v.flyers.length;i++){if(i===idx)continue;const a=sample(i);if(a[9])continue;const [ox,oy,s,rel]=at(a[0],a[1],a[2]);if(rel<-12||rel>80)continue;x.fillStyle=color(i);x.beginPath();x.arc(ox,oy,Math.max(4,8*s),0,Math.PI*2);x.fill();}
      x.globalAlpha=1;
      if(idx>=0&&v.flyers[idx]&&!f[9]){
        // your diver: a glowing disc in your colour, an outlined swept wing and a "YOU" tag
        const d=Math.min(2,devicePixelRatio||1),u=d*(1+Math.sin(performance.now()/260)*.06),col=color(idx);
        x.save();x.globalAlpha=.25;x.fillStyle=col;x.beginPath();x.ellipse(px,py+6*d,30*u,12*u,0,0,Math.PI*2);x.fill();x.globalAlpha=1;x.strokeStyle=col;x.lineWidth=3*d;x.stroke();
        x.shadowColor=col;x.shadowBlur=14*d;x.fillStyle=col;x.beginPath();x.moveTo(px,py-17*d);x.lineTo(px+19*d,py+9*d);x.lineTo(px+6*d,py+5*d);x.lineTo(px,py+11*d);x.lineTo(px-6*d,py+5*d);x.lineTo(px-19*d,py+9*d);x.closePath();x.fill();
        x.shadowBlur=0;x.strokeStyle='#ffffff';x.lineWidth=2*d;x.stroke();x.fillStyle='#ffffff';x.beginPath();x.arc(px,py-4*d,3.6*d,0,Math.PI*2);x.fill();
        x.font=`900 ${12*d}px system-ui,sans-serif`;x.textAlign='center';x.textBaseline='middle';const ty=py-30*d;x.fillStyle='#ffffffee';x.beginPath();x.roundRect?x.roundRect(px-20*d,ty-9*d,40*d,18*d,9*d):x.rect(px-20*d,ty-9*d,40*d,18*d);x.fill();x.fillStyle='#17223d';x.fillText('YOU',px,ty+1);x.restore();}
    }
    resize();return {resize,render,shake(){},dispose(){c.remove();}};
  }
  function sample(i){const raw=state(i);if(!raw||!V()?.flyers?.[i])return raw;const dt=Math.max(0,Math.min(.13,(performance.now()-gotAt)/1000));const v=V(),serverNow=(v.time||0)+dt,boosting=serverNow<(raw[13]||0),out=raw.slice();if(!raw[9]){out[0]=Math.min(v.length,raw[0]+(12.5+(boosting?4:0))*dt);out[1]=raw[1]+raw[3]*dt;out[2]=raw[2]+raw[4]*dt;}return out;}
  function loop(){ensureView();if(S){const v=V();(gl||flat)?.render(v);renderHud(v);}raf=requestAnimationFrame(loop);}
  function renderHud(v){if(!v||!Array.isArray(v.flyers)||!Array.isArray(v.seats))return;const i0=me(),watching=!(i0>=0&&v.flyers[i0]),f=watching?(v.flyers.reduce((a,b)=>(b[0]>a[0]?b:a),state(-1))):state(i0),depth=f[0]||0;
    const place=f[10]||(1+v.flyers.filter((a,j)=>j!==i0&&(a[9]>0?a[9]<=(f[9]||Infinity):!f[9]&&a[0]>depth)).length),ord=(n)=>n+(n%100>10&&n%100<14?'th':['th','st','nd','rd'][n%10]||'th');
    $('sdPlace').textContent=v.stage==='countdown'?`🪂 Run ${v.run} · get ready`:watching?`👀 Watching only · leader ${Math.floor(depth/v.length*100)}% · play from the lobby`:`${ord(place)} · ${Math.floor(depth/v.length*100)}%`;
    $('sdScore').textContent=`${f[5]||0} pts · ${f[6]||0} rings · ×${Math.max(1,f[7]||0)}`;$('sdCharges').textContent=f[8]??3;
    $('sdProgress').style.width=`${Math.min(100,depth/v.length*100)}%`;$('sdClock').textContent=`Run ${v.run}/${v.runs}`;
    const banner=$('sdBanner');if(v.stage==='results'){banner.hidden=false;banner.replaceChildren();const title=document.createElement('b');title.textContent=`Run ${v.run} complete`;banner.append(title);for(const [n,i] of v.finished.entries()){const row=document.createElement('p');row.textContent=`${n+1}. ${name(i)} · ${state(i)[5]} pts`;banner.append(row);}}else if(v.stage==='countdown'){banner.hidden=false;banner.textContent=`${Math.max(1,Math.ceil((v.go-Date.now()/1000)))}…`;}else banner.hidden=true;
    const seats=$('sdSeats');const key=JSON.stringify([v.points,v.ringTotals,v.flyers.map(a=>a[0])]);if(seats.dataset.key!==key){seats.dataset.key=key;seats.replaceChildren();v.seats.forEach((_,i)=>{const row=document.createElement('div');row.className='sd-row';const swatch=document.createElement('i');swatch.style.background=color(i);const label=document.createElement('span');label.textContent=name(i);const score=document.createElement('b');score.textContent=`${v.points[i]+(v.stage==='results'?0:state(i)[5])} pts`;const progress=document.createElement('small');progress.textContent=`${Math.floor(state(i)[0]/v.length*100)}%`;row.append(swatch,label,score,progress);seats.append(row);});}
  }
  function render(S0,ctx0){S=S0;ctx=ctx0;if(snap?.seed!==V()?.seed)lastSeq=-1;snap=V();gotAt=performance.now();if(lastSeq<0)events(V());ensureView();}
  function fast(data){if(data.skydrop){const old=V()||{};S={...S,skydrop:{...data.skydrop,me:old.me,seats:old.seats}};snap=S.skydrop;gotAt=performance.now();ensureView();events(S.skydrop);}}
  function events(v){const evs=v?.events||[];if(lastSeq<0||evs.some(e=>e[0]<lastSeq-40)){lastSeq=evs.at(-1)?.[0]??0;return;}for(const [n,kind,i] of evs){if(n<=lastSeq)continue;lastSeq=n;if(i!==me())continue;
    if(kind==='ring')ctx?.sfx?.('chip');else if(kind==='hit'){ctx?.sfx?.('thud');ctx?.buzz?.(40);(gl||flat)?.shake?.(.35);}else if(kind==='boost')ctx?.sfx?.('whoosh');else if(kind==='checkpoint')ctx?.sfx?.('rise');else if(kind==='finish')ctx?.sfx?.('fanfare');}}
  return {mount,render,fast,unmount,turnText:()=> '🪂 Dive through the rings · highest score wins'};
})();
