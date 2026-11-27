UI.switchyard = (() => {
  const depots = [
    ['●', 'Circle', '#ffae74'], ['◆', 'Diamond', '#72e6c2'],
    ['▲', 'Triangle', '#f7dc71'], ['■', 'Square', '#c6adff'],
  ];
  const nodes = {
    entry: [50, 10], main: [50, 34], west: [27, 57], east: [73, 57],
    0: [12, 87], 1: [36, 87], 2: [64, 87], 3: [88, 87],
  };
  const routes = { main: ['west', 'east'], west: [0, 1], east: [2, 3] };
  const names = { main: 'Main fork', west: 'West switch', east: 'East switch' };
  const heading = { west: 'West', east: 'East' };
  const cars = new Map(), pending = new Map();
  let yard, canvas, header, clock, beatBar, incoming, feedback, attribution, trains, buttons, bays, previews;
  let state, context, timer, deadline, lastArrival, trackKey, queueKey, resize, scene, animateScene;

  function drawBoard() {
    if (scene && state) scene.render(state.switchyard, animateScene);
    else draw();
  }

  function loadScene(board) {
    const layer = board.querySelector('.sy-scene');
    const current = () => board === yard && board.isConnected;
    const onLost = () => {
      if (!current() || !scene) return;
      scene.dispose();
      scene = null;
      board.classList.remove('sy-3d');
      trackKey = undefined;
      drawBoard();
    };
    GL3.load().then((T) => {
      if (!current()) return;
      scene = Switchyard3D.create(T, layer, { nodes, routes, depots, onLost });
      if (!scene) return;
      board.classList.add('sy-3d');
      drawBoard();
    }).catch(() => onLost());
  }

  function token(target) {
    const [symbol, name, color] = depots[target];
    const el = document.createElement('span');
    el.className = 'sy-token';
    el.style.setProperty('--depot', color);
    el.textContent = symbol;
    el.title = name;
    el.setAttribute('aria-label', name);
    return el;
  }

  function place(element, node) {
    const [x, y] = nodes[node];
    element.style.left = x + '%';
    element.style.top = y + '%';
  }

  function draw() {
    if (!state) return;
    const board = state.switchyard;
    const key = JSON.stringify([canvas.clientWidth, canvas.clientHeight, devicePixelRatio,
      board.switches, board.trains.map(({ node, route, target }) => [node, route, target])]);
    if (key === trackKey) return;
    trackKey = key;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    canvas.width = Math.round(width * devicePixelRatio);
    canvas.height = Math.round(height * devicePixelRatio);
    const pen = canvas.getContext('2d');
    if (!pen) return;
    pen.scale(devicePixelRatio, devicePixelRatio);
    function line(from, to, selected, color) {
      const [x, y] = nodes[from].map((v, i) => v * (i ? height : width) / 100);
      const [endX, endY] = nodes[to].map((v, i) => v * (i ? height : width) / 100);
      const dx = endX - x, dy = endY - y, length = Math.hypot(dx, dy);
      pen.beginPath();
      if (color) {
        // The committed route belongs to this train. Keep it beside the turnout indicator.
        const offsetX = 8 * dy / length, offsetY = -8 * dx / length;
        pen.moveTo(x + offsetX, y + offsetY);
        pen.lineTo(x + dx * .82 + offsetX, y + dy * .82 + offsetY);
        pen.setLineDash([5, 5]);
        pen.lineWidth = 3;
        pen.strokeStyle = color;
        pen.stroke();
        pen.setLineDash([]);
        return;
      }
      pen.moveTo(x, y);
      pen.lineTo(endX, endY);
      pen.lineWidth = 14;
      pen.strokeStyle = '#48595b';
      pen.stroke();
      pen.lineWidth = 8;
      pen.strokeStyle = selected ? '#eef6f8' : '#829393';
      pen.stroke();
      pen.lineWidth = 4;
      pen.strokeStyle = '#1a292e';
      pen.stroke();
      pen.lineWidth = 3;
      pen.setLineDash([2, 6]);
      pen.strokeStyle = '#90a3a0';
      pen.stroke();
      pen.setLineDash([]);
      if (selected) {
        const tipX = x + dx * .53, tipY = y + dy * .53;
        const backX = tipX - dx / length * 8, backY = tipY - dy / length * 8;
        const wingX = dy / length * 5, wingY = -dx / length * 5;
        pen.beginPath();
        pen.moveTo(backX + wingX, backY + wingY);
        pen.lineTo(tipX, tipY);
        pen.lineTo(backX - wingX, backY - wingY);
        pen.lineWidth = 6;
        pen.strokeStyle = '#1a292e';
        pen.stroke();
        pen.lineWidth = 3;
        pen.strokeStyle = '#eef6f8';
        pen.stroke();
      }
    }
    line('entry', 'main', false);
    for (const [node, ends] of Object.entries(routes)) {
      ends.forEach((end, i) => line(node, end, i === board.switches[node]));
    }
    for (const train of board.trains) {
      if (train.route !== undefined) line(train.node, train.route, false, depots[train.target][2]);
    }
  }

  function tick() {
    if (!state) return;
    const board = state.switchyard;
    const left = state.paused ? board.timeLeft : Math.max(0, (deadline - performance.now()) / 1000);
    const label = state.phase === 'over' ? '' : state.paused ? `Paused · ${Math.ceil(left)}s`
      : `${board.countdown ? 'Wave starts' : 'Next beat'} · ${Math.ceil(left)}s`;
    if (clock.textContent !== label) clock.textContent = label;
    beatBar.style.transform = `scaleX(${Math.min(1, left / board.beatLength)})`;
  }

  function mount(main) {
    main.innerHTML = `<section class="sy">
      <div class="sy-header"><strong class="sy-score"></strong><span class="sy-clock"></span></div>
      <div class="sy-beat" aria-hidden="true"><span></span></div>
      <div class="sy-board" role="group" aria-label="Rail yard">
        <canvas class="sy-flat" aria-hidden="true"></canvas>
        <div class="sy-scene" aria-hidden="true"></div>
        <span class="sy-entry">Entry</span>
        <div class="sy-incoming" role="group" aria-label="Next arrivals"></div>
        <div class="sy-trains"></div>
      </div>
      <p class="sy-feedback" role="status"></p>
      <p class="sy-attribution"></p>
    </section>`;
    yard = main.querySelector('.sy-board');
    canvas = yard.querySelector('canvas');
    header = main.querySelector('.sy-score');
    clock = main.querySelector('.sy-clock');
    beatBar = main.querySelector('.sy-beat span');
    incoming = main.querySelector('.sy-incoming');
    feedback = main.querySelector('.sy-feedback');
    attribution = main.querySelector('.sy-attribution');
    trains = yard.querySelector('.sy-trains');
    lastArrival = trackKey = queueKey = undefined;
    previews = ['Next', 'Then'].map(buildPreview);
    incoming.append(...previews.map((preview) => preview.slot));
    place(yard.querySelector('.sy-entry'), 'entry');
    bays = depots.map((_, index) => {
      const depot = token(index);
      depot.classList.add('sy-depot');
      place(depot, index);
      yard.append(depot);
      return depot;
    });
    buttons = Object.entries(names).map(([node, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sy-switch';
      button.dataset.switch = node;
      button.append(document.createElement('strong'), document.createElement('span'));
      button.firstChild.textContent = label;
      place(button, node);
      button.onclick = () => {
        const { switches, canSwitch, wave, beat } = state.switchyard;
        if (!canSwitch || pending.has(node)) return;
        const position = 1 - switches[node];
        const request = { position };
        pending.set(node, request);
        syncPending(button);
        const clear = () => {
          if (pending.get(node) !== request) return;
          pending.delete(node);
          syncPending(button);
        };
        context.quiet(context.act('set_switch', { switch: node, position, gameNo: state.gameNo, wave, beat }).then(() => {
          // SSE confirmation can arrive after the HTTP response.
          setTimeout(clear, 350);
        }, (error) => {
          clear();
          throw error;
        }));
      };
      yard.append(button);
      return button;
    });
    resize = new ResizeObserver(drawBoard);
    resize.observe(yard);
    timer = setInterval(tick, 50);
    loadScene(yard);
  }

  function buildPreview(label) {
    const slot = document.createElement('div');
    slot.className = 'sy-preview';
    const title = document.createElement('strong');
    title.textContent = label;
    const mark = document.createElement('span');
    const controls = document.createElement('span');
    controls.className = 'sy-call-controls';
    const caption = document.createElement('small');
    caption.className = 'sy-route-call';
    slot.append(title, mark, controls, caption);
    const preview = { slot, mark, controls, caption };
    preview.buttons = Object.entries(heading).map(([branch, name]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = branch === 'west' ? '↙' : '↘';
      button.title = `Call ${name}`;
      button.onclick = () => {
        if (!state.switchyard.canCall || !preview.train) return;
        context.quiet(context.act('call_route', { train: preview.train.id, branch, gameNo: state.gameNo }));
      };
      controls.append(button);
      return { button, branch, name };
    });
    return preview;
  }

  function updateQueue(board) {
    const upcoming = board.upcoming ?? board.incoming.map((target, id) => ({ id, target }));
    incoming.hidden = upcoming.length === 0;
    const key = JSON.stringify([upcoming, board.canCall, state.paused,
      state.players?.filter((player) => !player.spectator && !player.bot).length]);
    if (queueKey === key) return;
    queueKey = key;
    const shared = (state.players?.filter((player) => !player.spectator && !player.bot).length ?? 0) > 1;
    previews.forEach((preview, index) => {
      const train = upcoming[index];
      preview.train = train;
      preview.slot.hidden = !train;
      if (!train) return;
      if (preview.target !== train.target) {
        preview.target = train.target;
        preview.mark.replaceChildren(token(train.target));
      }
      preview.controls.hidden = !shared || state.me?.spectator;
      for (const { button, branch, name } of preview.buttons) {
        button.disabled = !board.canCall;
        button.setAttribute('aria-label', `Call ${name} for upcoming ${depots[train.target][1]} train ${index + 1}`);
        button.setAttribute('aria-pressed', String(train.call?.branch === branch));
      }
      preview.caption.textContent = train.call ? `${train.call.name} calls ${heading[train.call.branch]}` : '';
    });
  }

  function animateFlatArrival(board, animate) {
    const arrival = board.feedback;
    const car = arrival && cars.get(arrival.id);
    if (scene || !animate || !car?.animate || board.trains.some((train) => train.id === arrival.id)) return;
    const departure = car.cloneNode(true);
    departure.removeAttribute('data-train');
    departure.setAttribute('aria-hidden', 'true');
    trains.append(departure);
    const [x, y] = nodes[arrival.depot];
    const motion = departure.animate([
      { left: car.style.left, top: car.style.top },
      { left: x + '%', top: y + '%', transform: 'translate(-50%, -50%)', opacity: 0 },
    ], { duration: 260, fill: 'forwards', easing: 'ease-out' });
    motion.onfinish = motion.oncancel = () => departure.remove();
  }

  function syncPending(button) {
    const sending = pending.has(button.dataset.switch);
    button.classList.toggle('sy-pending', sending);
    button.setAttribute('aria-busy', String(sending));
  }

  function moveTrains(board, animate) {
    const active = new Set();
    for (const train of board.trains) {
      active.add(train.id);
      let car = cars.get(train.id);
      if (!car) {
        car = token(train.target);
        car.classList.add('sy-train');
        car.dataset.train = train.id;
        car.append(document.createElement('small'));
        cars.set(train.id, car);
        trains.append(car);
      }
      const route = train.route;
      car.classList.toggle('sy-moving', animate);
      car.dataset.node = train.node;
      car.dataset.route = route ?? '';
      const destination = route === undefined ? '' : heading[route] || depots[route][1];
      car.title = depots[train.target][1] + (destination ? ` train bound for ${destination}` : ' train at entry');
      car.setAttribute('role', 'img');
      car.setAttribute('aria-label', car.title);
      car.lastChild.textContent = route === undefined ? '' : heading[route] ? (route === 'west' ? '↙' : '↘') : depots[route][0];
      car.classList.toggle('sy-misrouted', !!train.missAt);
      place(car, train.node);
    }
    for (const [id, car] of cars) {
      if (!active.has(id)) {
        car.remove();
        cars.delete(id);
      }
    }
  }

  function render(view, ctx) {
    const board = view.switchyard;
    const previous = state?.switchyard;
    const sameBeat = previous?.wave === board.wave && previous.beat === board.beat;
    if (view !== state && (!sameBeat || view.paused !== state?.paused)) {
      deadline = performance.now() + board.timeLeft * 1000;
    }
    const motion = typeof motionOK === 'function' ? motionOK() : !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const contiguous = previous?.wave === board.wave && (sameBeat || board.beat === previous.beat + 1)
      || board.wave === previous?.wave + 1 && board.beat === 0;
    const animate = motion && state?.phase === 'playing' && !view.paused && !state.paused && contiguous;
    const receivedArrival = board.feedback && board.feedback.id !== lastArrival;
    state = view;
    context = ctx;
    animateScene = animate;
    header.textContent = `Wave ${board.wave}/${board.waves} · ${board.delivered}/${board.total} delivered · `
      + (board.goal ? `Goal ${board.goal} · Streak ${board.streak}` : `${board.strikes}/3 strikes`);
    tick();
    updateQueue(board);
    animateFlatArrival(board, animate);
    moveTrains(board, animate);
    const misses = new Set(board.trains.map((train) => train.missAt));
    if (board.feedback?.missAt) misses.add(board.feedback.missAt);
    const approaching = new Set(board.trains.map(({ node, route }) => node === 'entry' ? 'main' : node === 'main' ? route : null));
    for (const button of buttons) {
      const node = button.dataset.switch;
      const position = board.switches[node];
      const route = routes[node][position];
      const label = heading[route] || depots[route][0] + ' ' + depots[route][1];
      const due = view.phase === 'playing' && approaching.has(node);
      button.lastChild.textContent = heading[route] ? (position ? '↘ East' : '↙ West') : label;
      const suggested = board.hints?.[node];
      const hint = suggested === undefined ? '' : suggested === position ? ' · Ready' : ' · Flip';
      button.lastChild.textContent += hint;
      button.lastChild.style.color = heading[route] ? '' : depots[route][2];  // a depot's name wears its colour (#317)
      button.classList.toggle('sy-suggest', suggested !== undefined && suggested !== position);
      button.setAttribute('aria-label', `${names[node]}, set to ${label}${hint}.${due ? ' Train arriving next beat.' : ''}${misses.has(node) ? ' A train went off route here.' : ''} Flip switch.`);
      button.classList.toggle('sy-due', due);
      button.classList.toggle('sy-missed-switch', misses.has(node));
      button.disabled = !board.canSwitch;
      if (pending.get(node)?.position === position) pending.delete(node);
      syncPending(button);
    }
    drawBoard();
    const change = board.lastSwitch;
    const route = change && routes[change.switch][change.position];
    const note = change ? `${change.name} set ${names[change.switch]} to ${heading[route] || depots[route][1]}.` : '';
    if (attribution.textContent !== note) attribution.textContent = note;
    const arrival = board.feedback;
    if (receivedArrival) {
      lastArrival = arrival.id;
      feedback.className = 'sy-feedback ' + (arrival.correct ? 'sy-correct' : 'sy-wrong');
      feedback.textContent = arrival.correct ? `${depots[arrival.target][1]} train delivered!`
        : `${depots[arrival.target][0]} ${depots[arrival.target][1]} reached ${depots[arrival.depot][0]} ${depots[arrival.depot][1]}. ${board.goal ? 'Miss' : 'Strike'}${arrival.missAt ? ' at the ' + names[arrival.missAt].toLowerCase() : ''}!`;
      if (previous) context.sfx?.(arrival.correct ? 'good' : 'bad');
      const bay = bays[arrival.depot];
      if (motion) {
        bay.animate?.([{ boxShadow: `0 0 0 5px ${arrival.correct ? '#72e6c2' : '#ffae9d'}` },
          { boxShadow: '0 0 0 12px transparent' }], { duration: 450 });
      }
    }
  }

  return {
    mount, render,
    unmount() {
      clearInterval(timer);
      resize.disconnect();
      scene?.dispose();
      scene = null;
      yard = null;
      cars.clear();
      pending.clear();
      state = null;
    },
    turnText: (s) => s.phase === 'over' ? (s.switchyard.won ? 'Crew wins!' : 'Yard closed')
      : s.me.spectator ? 'Watching the yard' : 'Route the trains',
  };
})();
