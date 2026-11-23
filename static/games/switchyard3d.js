// Three.js presentation for the yard. Board snapshots are the only source of train routes.
const Switchyard3D = (() => {
  function create(T, layer, { nodes, routes, depots, onLost }) {
    const renderer = GL3.renderer({ alpha: true, powerPreference: 'default' },
      { cap: Math.min(window.devicePixelRatio || 1, 1.5), onLost });
    if (!renderer) return null;
    const scene = new T.Scene();
    const camera = new T.OrthographicCamera(-1, 1, 1, -1, 1, 500);
    camera.up.set(0, 0, -1);
    camera.position.set(0, 200, 0);
    camera.lookAt(0, 0, 0);
    const lights = GL3.stage(renderer, scene, { env: false, exposure: 'none',
      hemi: [0xd7ecff, 0x304135, 1.5], key: { pos: [-40, 80, -35], i: .95, shadow: false } });
    renderer.domElement.setAttribute('aria-hidden', 'true');
    layer.append(renderer.domElement);

    const yard = new T.Group(), stock = new T.Group();
    scene.add(yard, stock);
    const box = new T.BoxGeometry(1, 1, 1);
    const materials = new Map();
    const textures = [];
    const cars = new Map();
    const signals = new Map();
    const edges = [['entry', 'main'], ...Object.entries(routes).flatMap(([from, ends]) => ends.map((to) => [from, to]))];
    let tieMesh;
    let tracks = [], width = 0, height = 0, frame = 0, stateKey;

    function mat(color, lit = true) {
      const key = lit + color;
      if (!materials.has(key)) {
        const Material = lit ? T.MeshLambertMaterial : T.MeshBasicMaterial;
        materials.set(key, new Material({ color }));
      }
      return materials.get(key);
    }

    function block(parent, material, x, y, z, w, h, d, angle = 0) {
      const mesh = new T.Mesh(box, material);
      mesh.position.set(x, y, z);
      mesh.scale.set(w, h, d);
      mesh.rotation.y = angle;
      parent.add(mesh);
      return mesh;
    }

    function point(node) {
      const [x, z] = nodes[node];
      return new T.Vector3(width * (x / 100 - .5), 0, height * (z / 100 - .5));
    }

    function span(parent, material, a, b, y, w, h) {
      return block(parent, material, (a.x + b.x) / 2, y, (a.z + b.z) / 2,
        w, h, a.distanceTo(b), Math.atan2(b.x - a.x, b.z - a.z));
    }

    const roadbed = mat('#253b3e'), ties = mat('#637069'), steel = mat('#b2bab5');
    const active = mat('#a2efdb', false), idle = mat('#55747a', false);
    const shadow = mat('#142629', false), platform = mat('#29474e'), trim = mat('#779494');
    const lamps = depots.map(([, , color]) => mat(color, false));
    const shells = depots.map(([, , color]) => mat(color));
    const roof = mat('#19323b'), windowGlass = mat('#c7ecf0', false);
    const symbols = depots.map(([symbol]) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#19323b';
      ctx.fillRect(0, 0, 64, 64);
      ctx.font = 'bold 50px system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(symbol, 32, 31);
      const texture = new T.CanvasTexture(canvas);
      textures.push(texture);
      return new T.MeshBasicMaterial({ map: texture });
    });
    const sign = new T.PlaneGeometry(13, 13);
    const errorLamp = mat('#ff8978', false);

    function rebuild() {
      tieMesh?.dispose();
      while (yard.children.length) yard.remove(yard.children[yard.children.length - 1]);
      signals.clear();
      const sleepers = [];
      const transform = new T.Object3D();
      tracks = edges.map(([from, to]) => {
        const a = point(from), b = point(to);
        const axis = b.clone().sub(a).normalize();
        const side = new T.Vector3(axis.z, 0, -axis.x);
        span(yard, shadow, a, b, .4, 25, .8);
        span(yard, roadbed, a, b, 1, 21, 1.5);
        for (let offset = 6; offset < a.distanceTo(b) - 3; offset += 9) {
          const sleeper = a.clone().addScaledVector(axis, offset);
          transform.position.set(sleeper.x, 2, sleeper.z);
          transform.rotation.y = Math.atan2(axis.x, axis.z);
          transform.scale.set(18, 1, 3);
          transform.updateMatrix();
          sleepers.push(transform.matrix.clone());
        }
        for (const offset of [-5, 5]) {
          span(yard, steel, a.clone().addScaledVector(side, offset), b.clone().addScaledVector(side, offset), 3, 2.4, 2);
        }
        const signal = span(yard, idle, a.clone().lerp(b, .18), a.clone().lerp(b, .53), 3.5, 2.5, 1);
        const arrow = new T.Group();
        const tip = a.clone().lerp(b, .53);
        const back = tip.clone().addScaledVector(axis, -8);
        for (const wing of [-5, 5]) {
          span(arrow, active, back.clone().addScaledVector(side, wing), tip, 4.5, 3, 1);
        }
        yard.add(arrow);
        const trail = new T.Group();
        const lane = side.clone().multiplyScalar(-13);
        for (let i = 0; i < 5; i++) {
          const start = .22 + i * .12;
          span(trail, active, a.clone().lerp(b, start).add(lane), a.clone().lerp(b, start + .065).add(lane), 4, 3, 1);
        }
        yard.add(trail);
        return { from, to, signal, arrow, trail };
      });
      tieMesh = new T.InstancedMesh(box, ties, sleepers.length);
      sleepers.forEach((matrix, index) => tieMesh.setMatrixAt(index, matrix));
      tieMesh.frustumCulled = false;
      yard.add(tieMesh);
      for (const node of ['entry', 0, 1, 2, 3]) {
        const { x, z } = point(node);
        const deck = node === 'entry' ? trim : lamps[node];
        block(yard, shadow, x + 4, .5, z + 4, 46, 1, 34);
        block(yard, platform, x, 2, z, 46, 4, 34);
        block(yard, deck, x - 21, 5, z, 3, 3, 34);
        block(yard, deck, x + 21, 5, z, 3, 3, 34);
        if (node !== 'entry') signals.set(node, block(yard, idle, x, 5, z + 19, 25, 3, 4));
      }
    }

    function locomotive(target) {
      const model = new T.Group();
      block(model, shadow, 3, 3, 3, 19, 1, 31);
      block(model, roof, 0, 5, 0, 17, 4, 30);
      block(model, shells[target], 0, 9, 0, 15, 6, 26);
      block(model, trim, 0, 12, 0, 12, 3, 19);
      block(model, windowGlass, 0, 10, 12, 11, 2, 2);
      const lamp = block(model, errorLamp, 0, 13, -11, 12, 2, 2);
      const placard = new T.Group();
      const badge = new T.Mesh(sign, symbols[target]);
      badge.rotation.x = -Math.PI / 2;
      placard.position.y = 14;
      placard.add(badge);
      model.add(placard);
      return { model, placard, lamp };
    }

    // Park just upstream of the junction so the physical model never sits under a control.
    function pose(train, from) {
      const at = point(train.node);
      if (train.node === 'entry') return { at, angle: 0 };
      const origin = point(from);
      const direction = at.clone().sub(origin);
      const angle = Math.atan2(direction.x, direction.z);
      return { at: at.lerp(origin, Math.min(.58, 49 / direction.length())), angle };
    }

    function turn(car, angle) {
      car.model.rotation.y = angle;
      car.placard.rotation.y = -angle;
    }

    function paint(now) {
      frame = 0;
      let moving = false;
      for (const [id, car] of cars) {
        const t = car.move ? Math.min(1, (now - car.move.started) / 240) : 1;
        if (t >= 1) {
          car.model.position.copy(car.pose.at);
          turn(car, car.pose.angle);
          car.move = null;
          if (car.departing) {
            stock.remove(car.model);
            cars.delete(id);
          }
          continue;
        }
        const { start, via, distance } = car.move;
        const progress = 1 - (1 - t) ** 2;
        if (progress < distance) car.model.position.copy(start).lerp(via, progress / distance);
        else car.model.position.copy(via).lerp(car.pose.at, (progress - distance) / (1 - distance));
        turn(car, progress < distance ? car.move.angle : car.pose.angle);
        moving = true;
      }
      renderer.renderStill(scene, camera);
      if (moving) frame = requestAnimationFrame(paint);
    }

    function move(car, destination) {
      const start = car.model.position.clone(), via = point(car.node);
      const first = start.distanceTo(via);
      car.move = { start, via, distance: first / (first + via.distanceTo(destination)),
        angle: car.model.rotation.y, started: performance.now() };
    }

    function render(board, animate) {
      const w = layer.clientWidth, h = layer.clientHeight;
      if (!w || !h) return;
      const resized = w !== width || h !== height;
      if (resized) {
        width = w;
        height = h;
        Object.assign(camera, { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2 });
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
        rebuild();
      }
      const key = JSON.stringify([board.switches, board.trains, board.feedback?.id]);
      if (!resized && key === stateKey) {
        if (animate || !frame) return;
        for (const car of cars.values()) car.move = null;
        cancelAnimationFrame(frame);
        paint(performance.now());
        return;
      }
      stateKey = key;
      const commitments = new Map(board.trains.map((train) => [train.node, train]));
      for (const { from, to, signal, arrow, trail } of tracks) {
        const selected = routes[from]?.[board.switches[from]] === to;
        signal.material = selected ? active : idle;
        arrow.visible = selected;
        const train = commitments.get(from);
        trail.visible = train?.route === to;
        if (trail.visible) for (const dash of trail.children) dash.material = lamps[train.target];
      }
      const arrival = board.feedback;
      for (const [depot, signal] of signals) {
        signal.material = arrival?.depot === depot ? (arrival.correct ? active : errorLamp) : idle;
      }
      const activeIds = new Set();
      for (const train of board.trains) {
        activeIds.add(train.id);
        const from = train.node === 'main' ? 'entry' : 'main';
        let car = cars.get(train.id);
        if (!car) {
          car = locomotive(train.target);
          stock.add(car.model);
          cars.set(train.id, car);
        }
        car.lamp.visible = !!train.missAt;
        const next = pose(train, from);
        if (resized || !animate) car.move = null;
        else if (car.node && car.node !== train.node) {
          move(car, next.at);
        }
        car.node = train.node;
        car.pose = next;
      }
      for (const [id, car] of cars) {
        if (activeIds.has(id)) continue;
        if (animate && !resized && arrival?.id === id && car.node === (arrival.depot < 2 ? 'west' : 'east')) {
          if (!car.departing) {
            const at = point(arrival.depot), from = point(car.node);
            car.pose = { at, angle: Math.atan2(at.x - from.x, at.z - from.z) };
            car.departing = true;
            move(car, at);
          }
        } else {
          stock.remove(car.model);
          cars.delete(id);
        }
      }
      cancelAnimationFrame(frame);
      paint(performance.now());
    }

    return { render, dispose() {
      cancelAnimationFrame(frame);
      lights.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      tieMesh?.dispose();
      box.dispose();
      sign.dispose();
      for (const material of materials.values()) material.dispose();
      for (const material of symbols) material.dispose();
      for (const texture of textures) texture.dispose();
    } };
  }

  return { create };
})();
