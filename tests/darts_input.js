// Run with node tests/darts_input.js after installing the test dependencies.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');

async function test() {
  const { window } = new JSDOM('<main></main><aside></aside>', { runScripts: 'outside-only', url: 'http://darts.test/?axeDebug=1' });
  const { document } = window;
  const actions = [];
  let rejectThrow = false;
  let frame;
  window.requestAnimationFrame = (callback) => { frame = callback; return 1; };
  window.cancelAnimationFrame = () => {};
  let reducedMotion = true;
  window.matchMedia = () => ({ matches: reducedMotion });
  window.UI = {};
  window.eval(readFileSync(join(__dirname, '../static/games/archery.js'), 'utf8'));

  const ui = window.UI.archery;
  const context = {
    myTurn: true,
    player: () => ({ name: 'Tester' }),
    el: (tag, cls, text) => Object.assign(document.createElement(tag), {
      className: cls || '', textContent: text || '',
    }),
    act: async (type, payload) => {
      actions.push({ type, payload });
      if (rejectThrow) throw new Error('Rejected throw');
    },
    quiet: (promise) => promise.catch(() => {}),
  };
  const darts = {
    title: '301', mode: '301', x01: true, readyIn: 0, roundRecap: false, seats: ['a'],
    active: [0], me: 0, next: 0, left: 3, visit: 1, numbers: [20], darts: [],
    points: [301], checkout: [], swipePace: 2.2, spreadBase: 0.03, spreadPerPace: 0.012,
    radii: [0.037, 0.094, 0.58, 0.63, 0.953, 1],
  };
  const render = () => ui.render({ phase: 'playing', darts }, context);
  const tick = () => frame(window.performance.now());
  const press = (element, key, options = {}) => {
    element.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...options }));
  };
  const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8);

  try {
    ui.mount(document.querySelector('main'), document.querySelector('aside'));
    render();
    tick();
    const board = document.querySelector('.ar-darts svg[tabindex]');
    const button = document.querySelector('.ar-darts-swipe');
    const spread = document.querySelector('.ar-darts-spread');
    assert.ok(spread.hidden);

    press(board, 'ArrowLeft');
    press(board, 'ArrowUp', { shiftKey: true });
    tick();
    assert.equal(spread.hidden, false);
    closeTo(parseFloat(spread.style.left), (125 - 0.02 * 98) / 2.5);
    closeTo(parseFloat(spread.style.top), (125 - 0.20 * 98) / 2.5);
    press(board, 'Enter');
    press(board, 'Enter', { repeat: true });
    tick();
    assert.ok(spread.hidden);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'throw');
    closeTo(actions[0].payload.dx, -1.06);
    closeTo(actions[0].payload.dy, 0.75);
    assert.equal(actions[0].payload.vx, -2.2);
    await new Promise(setImmediate);
    tick();

    press(button, 'ArrowDown');
    tick();
    assert.equal(spread.hidden, false);
    press(button, 'Escape');
    tick();
    assert.ok(spread.hidden);
    press(button, 'ArrowLeft');
    button.dispatchEvent(new window.FocusEvent('blur'));
    tick();
    assert.ok(spread.hidden);
    press(button, ' ');
    assert.equal(actions.length, 2);
    await new Promise(setImmediate);

    press(board, 'ArrowLeft');
    context.myTurn = false;
    render();
    press(board, 'Enter');
    tick();
    assert.ok(spread.hidden);
    context.myTurn = true;
    darts.roundRecap = true;
    render();
    press(board, 'Enter');
    assert.equal(actions.length, 2);

    const landing = document.querySelector('.ar-darts-landing');
    const hint = document.querySelector('.ar-darts-aim');
    assert.ok(landing.hasAttribute('hidden'));
    darts.roundRecap = false;
    darts.hint = { x: 0, y: 0, label: 'Bull' };
    render();
    tick();
    document.querySelector('.ar-darts-hintbtn').click();
    tick();
    assert.equal(hint.hidden, false);
    press(board, 'ArrowUp');
    tick();
    assert.equal(spread.hidden, false);

    darts.shot = { id: 1, o: 0, x: 0.2, y: 0.4, number: 1, multiplier: 1, label: 'S1', points: 300 };
    darts.darts = [darts.shot];
    context.peek = true;
    render();
    assert.equal(landing.hasAttribute('hidden'), false);
    assert.equal(landing.firstElementChild.getAttribute('transform'), 'translate(144.6 85.8)');
    press(board, 'Enter');
    assert.ok(landing.hasAttribute('hidden'));
    await new Promise(setImmediate);

    darts.shot = { id: 2, o: 0, x: 1.1, y: 0, number: 0, multiplier: 0, label: 'Miss', points: 300 };
    darts.darts.push(darts.shot);
    render();
    assert.ok(landing.hasAttribute('hidden'));

    darts.shot = { id: 3, o: 0, x: 0, y: 0, number: 25, multiplier: 2, label: 'Bull', points: 250 };
    darts.darts.push(darts.shot);
    render();
    assert.equal(landing.hasAttribute('hidden'), false);
    darts.darts = [];
    render();
    assert.ok(landing.hasAttribute('hidden'));

    const trail = document.querySelector('.ar-darts-trail');
    const impact = document.querySelector('.ar-darts-impact');
    const flash = document.querySelector('.ar-darts-hitflash');
    assert.ok(trail.hasAttribute('hidden'));
    assert.ok(impact.hasAttribute('hidden'));
    assert.ok(!flash.classList.contains('ar-darts-lit'));

    reducedMotion = false;
    darts.shot = { ...darts.shot, id: 4 };
    darts.darts = [darts.shot];
    render();
    frame(window.performance.now() + 200);
    assert.equal(trail.hasAttribute('hidden'), false);
    assert.notEqual(trail.lastElementChild.getAttribute('x1'), trail.lastElementChild.getAttribute('x2'));
    assert.ok(impact.hasAttribute('hidden'));
    const flyingPin = document.querySelector('[data-shot="4"]');
    assert.match(flyingPin.getAttribute('transform'), /rotate\(-[1-9]/);
    frame(window.performance.now() + 650);
    assert.equal(flyingPin.getAttribute('transform'), 'translate(125 125) rotate(-34)');
    assert.equal(flyingPin.querySelector('.ar-darts-tip').getAttribute('d').slice(0, 4), 'M0 0');
    assert.ok(trail.hasAttribute('hidden'));
    assert.equal(impact.dataset.kind, 'bull');
    assert.equal(impact.hasAttribute('hidden'), false);

    reducedMotion = true;
    darts.shot = { id: 5, o: 0, x: 1.1, y: 0, number: 0, multiplier: 0, label: 'Miss', points: 250 };
    darts.darts.push(darts.shot);
    render();
    assert.equal(impact.dataset.kind, 'miss');
    assert.equal(document.querySelector('[data-shot="5"]'), null);
    assert.equal(impact.hasAttribute('hidden'), false);
    assert.ok(trail.hasAttribute('hidden'));
    darts.shot = { ...darts.shot, id: 6, x: 2 };
    darts.darts.push(darts.shot);
    render();
    assert.ok(impact.hasAttribute('hidden'));
    assert.equal(document.querySelector('.ar-darts-callout').textContent, 'Miss');

    ui.unmount();
    ui.mount(document.querySelector('main'), document.querySelector('aside'));
    render();
    tick();
    assert.ok(document.querySelector('.ar-darts-trail').hasAttribute('hidden'));
    assert.ok(document.querySelector('.ar-darts-impact').hasAttribute('hidden'));
    assert.ok(document.querySelector('.ar-darts-callout').hidden);
    assert.equal(document.querySelector('[data-shot="6"]'), null);

    reducedMotion = false;
    darts.shot = { ...darts.shot, id: 7, x: 1.1 };
    darts.darts = [darts.shot];
    render();
    const arrived = window.performance.now() + 650;
    const holes = document.querySelector(".ar-darts-holes").childElementCount;
    const miss = document.querySelector('[data-shot="7"]');
    frame(arrived);
    assert.ok(!miss.hasAttribute('hidden'));
    const start = miss.getAttribute('transform');
    frame(arrived + 75);
    assert.notEqual(miss.getAttribute('transform'), start);
    assert.equal(document.querySelector('.ar-darts-holes').childElementCount, holes);
    assert.equal(document.querySelector('.ar-darts-swipe').disabled, false);
    frame(arrived + 151);
    assert.ok(miss.hasAttribute('hidden'));
    darts.darts = [];
    render();
    assert.equal(document.querySelector('[data-shot="7"]'), null);

    tick();
    const currentBoard = document.querySelector('.ar-darts-input');
    const currentSpread = document.querySelector('.ar-darts-spread');
    const inspect = document.querySelector('.ar-darts-inspect');
    const tabletop = document.querySelector('.ar-darts-tabletop');
    let pointerTime = 0;
    const pointer = (type, x, y) => {
      const event = new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      Object.defineProperty(event, 'timeStamp', { value: pointerTime += 10 });
      currentBoard.dispatchEvent(event);
    };
    currentBoard.getBoundingClientRect = () => ({ left: 0, width: 250 });
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 160, 120);
    pointer('pointerup', 160, 120);
    assert.equal(tabletop.style.transform, '');
    assert.equal(inspect.getAttribute('aria-pressed'), 'false');

    inspect.click();
    assert.equal(inspect.getAttribute('aria-pressed'), 'true');
    assert.match(tabletop.style.transform, /rotateY\(-24deg\)/);
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 160, 120);
    pointer('pointerup', 160, 120);
    assert.match(tabletop.style.transform, /rotateY\(-3deg\)/);
    pointer('pointerdown', 100, 100);
    pointer('pointerup', 100, 100);
    assert.equal(tabletop.style.transform, '');

    const count = actions.length;
    pointer('pointerdown', 110, 100);
    pointer('pointermove', 30, 190);
    pointer('pointerup', 30, 190);
    assert.equal(actions.length, count);
    assert.equal(tabletop.style.transform, '');
    inspect.click();
    pointer('pointerdown', 100, 100);
    inspect.click();
    pointer('pointermove', 160, 120);
    pointer('pointerup', 160, 120);
    assert.equal(tabletop.style.transform, '');
    pointer('pointerdown', 180, 100);
    pointer('pointermove', 130, 155);
    tick();
    assert.equal(currentSpread.hidden, false);
    closeTo(parseFloat(currentSpread.style.width), 4 * (0.03 + 0.012 * Math.hypot(6, 6)) * 98 / 250 * 100);
    pointer('pointerup', 130, 155);
    assert.equal(actions[count].type, 'throw');
    assert.equal(actions[count].payload.vx, -6);
    assert.equal(actions[count].payload.vy, -6);
    await new Promise(setImmediate);

    reducedMotion = true;
    darts.shot = { ...darts.shot, id: 8 };
    darts.roundRecap = true;
    darts.completedVisit = { visit: darts.visit, seat: 0, reason: 'bust', darts: [darts.shot], before: 301, after: 301 };
    render();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 150, 100);
    pointer('pointerup', 150, 100);
    assert.equal(actions.length, count + 1);
    pointer('pointerdown', 100, 100);
    pointer('pointerup', 100, 100);
    assert.equal(actions.length, count + 1);
    assert.match(document.querySelector('.ar-darts-turn').textContent, /Round complete/);
    assert.match(document.querySelector('.ar-darts-visit-card').textContent, /Restored to 301/);
    inspect.click();

    const currentLanding = document.querySelector('.ar-darts-landing');
    const currentTrail = document.querySelector('.ar-darts-trail');
    darts.roundRecap = false;
    context.myTurn = false;
    reducedMotion = false;
    tick();
    inspect.click();
    const angleBeforeThrow = tabletop.style.transform;
    darts.shot = { ...darts.shot, id: 9, number: 25, x: 0, y: 0, o: 1 };
    darts.darts = [darts.shot];
    render();
    frame(window.performance.now() + 180);
    assert.equal(currentTrail.hasAttribute('hidden'), false);
    assert.equal(tabletop.style.transform, angleBeforeThrow);
    assert.equal(inspect.disabled, false);
    pointer('pointerdown', 80, 80);
    pointer('pointermove', 120, 130);
    pointer('pointerup', 120, 130);
    const spectatorAngle = tabletop.style.transform;
    assert.notEqual(spectatorAngle, angleBeforeThrow);
    frame(window.performance.now() + 700);
    assert.equal(currentLanding.hasAttribute('hidden'), false);
    assert.equal(tabletop.style.transform, spectatorAngle);
    render();
    frame(window.performance.now() + 1160);
    assert.ok(currentLanding.hasAttribute('hidden'));
    render();
    assert.ok(currentLanding.hasAttribute('hidden'));

    reducedMotion = true;
    darts.shot = { ...darts.shot, id: 10 };
    darts.darts = [darts.shot];
    render();
    frame(window.performance.now() + 150);
    assert.equal(currentLanding.hasAttribute('hidden'), false);
    frame(window.performance.now() + 260);
    assert.ok(currentLanding.hasAttribute('hidden'));

    const firstHit = darts.shot;
    const firstPin = document.querySelector('[data-shot="10"]');
    const firstPose = firstPin.getAttribute('transform');
    reducedMotion = false;
    darts.visit += 1;
    darts.shot = { ...firstHit, id: 11, o: 0 };
    darts.darts = [firstHit, darts.shot];
    render();
    frame(window.performance.now() + 180);
    assert.equal(document.querySelector('[data-shot="10"]'), firstPin);
    assert.equal(firstPin.getAttribute('transform'), firstPose);
    frame(window.performance.now() + 700);
    const secondPose = document.querySelector('[data-shot="11"]').getAttribute('transform');
    assert.match(secondPose, /^translate[(]125 125[)] rotate/);
    assert.notEqual(secondPose, firstPose);
    darts.darts = [];
    render();
    assert.equal(document.querySelector('[data-shot="10"]'), null);
    assert.equal(document.querySelector('[data-shot="11"]'), null);

    darts.aimControl = true;
    context.myTurn = true;
    reducedMotion = true;
    render();
    tick();
    const adjust = document.querySelector('.ar-darts-adjust');
    const horizontal = adjust.querySelector('input');
    const release = adjust.querySelector('button');
    const status = document.querySelector('.ar-darts-aim-status');
    const swipeButton = document.querySelector('.ar-darts-swipe');
    assert.equal(adjust.hidden, false);
    horizontal.value = '25';
    horizontal.dispatchEvent(new window.Event('input', { bubbles: true }));
    tick();
    assert.match(status.textContent, /Spread radius 6%/);
    assert.equal(currentSpread.hidden, false);

    const touch = (target, type, id, x) => {
      const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 100 });
      Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: 'touch' } });
      target.dispatchEvent(event);
    };
    const before = actions.length;
    touch(currentBoard, 'pointerdown', 1, 45);
    touch(currentBoard, 'pointerdown', 2, 90);
    touch(currentBoard, 'pointermove', 2, 115);
    assert.match(tabletop.style.transform, /scale\(/);
    assert.doesNotMatch(tabletop.style.transform, /rotate/);
    touch(currentBoard, 'pointerup', 2, 115);
    touch(currentBoard, 'pointerup', 1, 45);
    assert.equal(actions.length, before);
    touch(horizontal, 'pointerdown', 1, 100);
    touch(document.body, 'pointerdown', 2, 90);
    touch(horizontal, 'pointerup', 1, 100);
    touch(document.body, 'pointerup', 2, 90);
    assert.equal(horizontal.value, '0');
    assert.match(status.textContent, /Try again/);
    touch(swipeButton, 'pointerdown', 1, 180);
    touch(document.body, 'pointerdown', 2, 100);
    touch(currentBoard, 'pointerup', 1, 70);
    touch(document.body, 'pointerup', 2, 100);
    assert.equal(actions.length, before);
    touch(currentBoard, 'pointerdown', 1, 180);
    touch(currentBoard, 'pointermove', 1, 110);
    touch(currentBoard, 'pointercancel', 1, 110);
    touch(currentBoard, 'pointerup', 1, 70);
    assert.equal(actions.length, before);

    horizontal.value = '25';
    horizontal.dispatchEvent(new window.Event('input', { bubbles: true }));
    rejectThrow = true;
    release.click();
    await new Promise(setImmediate);
    assert.match(status.textContent, /Throw failed/);
    rejectThrow = false;
    release.click();
    await new Promise(setImmediate);
    assert.equal(actions.length, before + 2);
    closeTo(actions.at(-1).payload.dx, -0.79);
    closeTo(actions.at(-1).payload.dy, 0.55);
    assert.equal(actions.at(-1).payload.vx, 0);

    ui.unmount();
    Object.assign(darts, {
      mode: 'axe', title: 'Axe Throwing', x01: false, visitsDone: [0], visitLimit: 8,
      axeRings: [[0.2, 5], [0.4, 4], [0.6, 3], [0.8, 2], [1, 1]],
      shot: { id: 11, o: 0, x: 0, y: 0, number: 5, multiplier: 1, label: '5-point ring', value: 5 },
    });
    darts.darts = [darts.shot];
    render();
    tick();
    const axeBoard = document.querySelector('.ar-darts-input');
    assert.match(axeBoard.getAttribute('aria-label'), /^Axe target/);
    assert.equal(axeBoard.querySelectorAll('.ar-darts-board text').length, 5);
    assert.ok(axeBoard.querySelector('[data-shot="11"] polygon'));
    assert.match(document.querySelector('.ar-darts-result').textContent, /5-point ring/);
    const debug = document.querySelector('.ar-darts-axe-debug');
    assert.ok(!debug.hidden);
    assert.equal(debug.open, false);
    const traceButton = debug.querySelector('.ar-darts-axe-trace-copy');
    const traceRows = () => Array.from(debug.querySelectorAll('tbody tr'),
      (row) => Array.from(row.cells, (cell) => cell.textContent));
    assert.ok(traceButton.disabled, 'restored shot has no launch trace');
    debug.open = true;
    const roll = debug.querySelector('[data-axis="roll"]');
    roll.value = '35';
    roll.dispatchEvent(new window.Event('input', { bubbles: true }));
    tick();
    assert.match(debug.querySelector('.ar-darts-axe-readout').textContent, /X .* · Y .* · Z .*Roll 35°/);
    let copied;
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: async (text) => { copied = text; } },
    });
    debug.querySelector('.ar-darts-axe-copy').click();
    await new Promise(setImmediate);
    assert.equal(copied, debug.querySelector('.ar-darts-axe-readout').textContent);
    assert.equal(debug.querySelector('.ar-darts-axe-copy-status').textContent, 'Copied.');

    const tilted = document.querySelector('.ar-darts-held').getAttribute('transform');
    debug.querySelector('.ar-darts-axe-reset').click();
    tick();
    assert.equal(roll.value, '0');
    assert.equal(debug.querySelector('[data-axis="pitch"]').value, '12');
    assert.equal(debug.querySelector('[data-axis="yaw"]').value, '-60');
    assert.notEqual(document.querySelector('.ar-darts-held').getAttribute('transform'), tilted);
    debug.open = false;
    darts.axeStickSpeed = [1.5, 5.5];
    darts.axeStickAngle = 30;
    darts.axeSpin = {
      referenceSpeed: 3.5, referenceRate: 322 / 0.533, rateGain: 51,
      airBaseMs: 620, airMinMs: 470, airMsPerSpeed: 25,
    };
    axeBoard.getBoundingClientRect = () => ({ left: 0, width: 250 });
    const axePointer = (type, x, y, timeStamp, target = axeBoard, pointerType = "mouse", pointerId = 31) => {
      const event = new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
      Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: pointerType }, timeStamp: { value: timeStamp } });
      target.dispatchEvent(event);
    };
    const axeThrowButton = document.querySelector('.ar-darts-swipe');
    axePointer('pointerdown', 200, 180, 0, axeThrowButton);
    axePointer('pointermove', 151, 120, 160);
    tick();
    const swipeMatrix = /matrix\(([^)]+)\)/.exec(document.querySelector('.ar-darts-held').getAttribute('transform'))[1]
      .split(' ').map(Number);
    assert.ok(Math.abs(swipeMatrix[2]) < 1e-8 && swipeMatrix[3] < 1.05, 'the handle pitches without sideways roll');
    const heldX = Number(/translate\(([^ ]+)/.exec(document.querySelector('.ar-darts-held').getAttribute('transform'))[1]);
    assert.ok(heldX < 192 && heldX > 182, 'the axe visibly follows the drag inside the throwing area');
    assert.match(document.querySelector('.ar-darts-aim-status').textContent, /Blade-first · 14° from ideal/);
    assert.match(document.querySelector('.ar-darts-axe-live').textContent, /^Blade-first/);
    axePointer('pointercancel', 151, 120, 170);

    reducedMotion = false;
    const animationStart = window.performance.now();
    window.performance.now = () => animationStart;
    darts.shot = { ...darts.shot, id: 12 };
    darts.darts.push(darts.shot);
    render();
    const flightStart = window.performance.now();
    debug.open = true;
    const live = document.querySelector('.ar-darts-axe-live');
    const depth = () => Number(/Z (-?[\d.]+)/.exec(live.textContent)[1]);
    const flyingAxe = axeBoard.querySelector('[data-shot="12"]');
    const matrix = (transform) => /matrix\(([^)]+)\)/.exec(transform)[1].split(' ').map(Number);
    const flightMatrix = () => matrix(flyingAxe.getAttribute('transform'));
    const projectedPoint = (axe, [x, y]) => {
      const transform = axe.getAttribute('transform');
      const [tx, ty] = /translate\(([^)]+)\)/.exec(transform)[1].split(' ').map(Number);
      const [a, b, c, d] = matrix(transform);
      return [tx + a * x + c * y * 0.74, ty + b * x + d * y * 0.74];
    };
    const heightRatio = (yaw = 78) => {
      const [width, , sidewaysY, height] = flightMatrix();
      assert.ok(Math.abs(sidewaysY) < 1e-8);
      return height * Math.cos(yaw * Math.PI / 180) / width;
    };
    frame(flightStart);
    assert.ok(!live.hidden);
    assert.match(live.textContent, /^Windup · X .* · Y .* · Z 0.49$/);
    const startPosition = live.textContent;
    assert.ok(Math.abs(heightRatio(60) - Math.cos(12 * Math.PI / 180)) < 0.001);
    frame(flightStart + 60);
    assert.ok(document.querySelector('.ar-darts-trail').hasAttribute('hidden'));
    assert.ok(Math.abs(heightRatio() - Math.cos(40 * Math.PI / 180)) < 0.001);
    frame(flightStart + 138);
    const beforeRelease = heightRatio();
    frame(flightStart + 143);
    const afterRelease = heightRatio();
    assert.ok(beforeRelease > 0.997 && afterRelease > 0.997);
    assert.ok(Math.abs(afterRelease - beforeRelease) < 0.003);
    assert.ok(!document.querySelector('.ar-darts-trail').hasAttribute('hidden'));
    frame(flightStart + 250);
    assert.match(live.textContent, /^Flight · X .* · Y .* · Z /);
    assert.notEqual(live.textContent, startPosition);
    const earlyDepth = depth();
    const earlyPitch = heightRatio();
    frame(flightStart + 400);
    assert.ok(traceButton.disabled);
    assert.ok(depth() < earlyDepth);
    assert.ok(earlyPitch > 0.3 && heightRatio() < -0.7);
    const [projectedWidth, , , projectedHeight] = matrix(flyingAxe.getAttribute('transform'));
    assert.ok(projectedWidth > 0.28 && projectedHeight < -1, 'axe flips into depth without mirroring across the screen');
    frame(flightStart + 750);
    const centerEdge = [-3.2 * 1.15, 2.3 * 1.10];
    const marker = axeBoard.querySelector('.ar-darts-axe-contact-marker');
    assert.ok(!marker.hasAttribute('hidden'));
    assert.equal(marker.getAttribute('cx'), '125');
    assert.equal(marker.getAttribute('cy'), '125');
    const poseAtImpact = flyingAxe.getAttribute('transform');
    for (const value of projectedPoint(flyingAxe, centerEdge)) closeTo(value, 125);
    frame(flightStart + 810);
    assert.notEqual(flyingAxe.getAttribute('transform'), poseAtImpact);
    for (const value of projectedPoint(flyingAxe, centerEdge)) closeTo(value, 125);
    assert.match(debug.querySelector('.ar-darts-axe-contact-summary').textContent, /Contact · edge 2/);
    assert.equal(live.textContent, 'Impact · X 0.00 · Y 0.00 · Z 0.00');
    debug.querySelector('.ar-darts-axe-copy-flight').click();
    await new Promise(setImmediate);
    assert.equal(copied, live.textContent);
    const rows = traceRows();
    assert.deepEqual(rows.map(([time]) => Number(time)), [0, 60, 140, 280, 420, 560, 700]);
    assert.equal(rows[6][1], 'Impact');
    assert.equal(rows[6][5], '-322.0');
    assert.ok(Number(rows[6][4]) > 0.02, 'the blade reference remains in front of its anchored edge');
    assert.ok(Number(rows[4][4]) < Number(rows[3][4]));
    assert.ok(Number(rows[4][5]) < Number(rows[3][5]));
    assert.notDeepEqual(rows[0].slice(6), rows[1].slice(6));
    for (const [index, row] of rows.entries()) {
      const [qx, qy, qz, qw] = row.slice(6).map(Number);
      const yaw = Math.atan2(2 * (qx * qz + qy * qw), 1 - 2 * (qy ** 2 + qz ** 2)) * 180 / Math.PI;
      assert.ok(Math.abs(yaw + (index ? 78 : 60)) < 0.03, 'the blade aligns during windup and holds its flight heading');
      assert.ok(Math.abs(2 * (qx * qy - qz * qw)) < 0.0002, 'the handle stays in the forward plane');
    }
    traceButton.click();
    await new Promise(setImmediate);
    assert.match(copied, /Time \(ms\)\tPhase\tX\tY\tZ/);
    assert.ok(copied.endsWith(rows[6].join('\t')));
    assert.match(copied, /Contact · edge 2/);
    assert.match(copied, /Collision estimate/);
    assert.ok(document.querySelector('.ar-darts-trail').hasAttribute('hidden'));
    darts.axeStickSpeed = [1.5, 5.5];
    darts.shot = {
      ...darts.shot, id: 13, number: 0, value: 0, axeAngle: 45, axeBounce: true, label: 'Over-rotated',
    };
    darts.darts.push(darts.shot);
    render();
    const bounceStart = window.performance.now();
    const bouncingAxe = axeBoard.querySelector('[data-shot="13"]');
    frame(bounceStart + 700);
    assert.ok(!marker.hasAttribute('hidden'));
    const bounceImpact = depth();
    frame(bounceStart + 740);
    assert.ok(depth() > bounceImpact);
    assert.match(document.querySelector('.ar-darts-result').textContent, /Over-rotated · 0 points/);
    assert.equal(document.querySelector('.ar-darts-hitflash').children.length, 0);
    assert.ok(!bouncingAxe.hasAttribute('hidden'));
    assert.match(live.textContent, /^Bounce · X /);
    assert.deepEqual(traceRows().slice(-2).map((row) => row.slice(0, 2)), [['800', 'Bounce'], ['950', 'Bounce']]);
    frame(bounceStart + 1060);
    assert.ok(bouncingAxe.hasAttribute('hidden'));

    reducedMotion = true;
    darts.shot = { ...darts.shot, id: 14, axeAngle: -45, label: 'Under-rotated' };
    darts.darts.push(darts.shot);
    render();
    assert.match(document.querySelector('.ar-darts-result').textContent, /Under-rotated · 0 points/);
    assert.equal(axeBoard.querySelector('[data-shot="14"]'), null);
    assert.equal(traceRows().length, 9);
    assert.match(debug.querySelector('.ar-darts-axe-contact-summary').textContent, /Contact · edge 1/);
    const handleHit = { ...darts.shot, id: 140, axeAngle: 75, axeTurn: 397, label: 'Over-rotated' };
    darts.shot = handleHit;
    darts.darts.push(handleHit);
    render();
    assert.match(debug.querySelector('.ar-darts-axe-contact-summary').textContent, /Collision estimate · handle/);
    darts.shot = { ...darts.shot, id: 15, axeBounce: false, label: 'Miss', x: 1.1 };
    darts.darts.push(darts.shot);
    render();
    assert.equal(document.querySelector('.ar-darts-result').textContent, 'Miss · 0 points');
    assert.deepEqual(traceRows().slice(-3).map((row) => row[1]), ['Board plane', 'Past target', 'Past target']);
    assert.ok(Number(traceRows().at(-1)[4]) < 0);
    tick();
    assert.ok(marker.hasAttribute('hidden'));
    assert.match(debug.querySelector('.ar-darts-axe-contact-summary').textContent, /shot passed the board plane/);
    const logged = [];
    context.logAxeDebug = async (entry) => logged.push(entry);
    axePointer('pointerdown', 200, 180, 1000, axeThrowButton);
    axePointer('pointermove', 200, 180, 1100);
    axePointer('pointermove', 195, 180, 1200);
    axePointer('pointerup', 135, 180, 1250);
    await new Promise(setImmediate);
    darts.shot = { ...darts.shot, id: 16, number: 5, value: 5, label: '5-point ring', x: 0, axeAngle: 0, axeTurn: 322 };
    darts.darts.push(darts.shot);
    render();
    await new Promise(setImmediate);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].shotId, 16);
    assert.equal(logged[0].swipe.durationMs, 250);
    assert.equal(logged[0].swipe.sampleCount, 4);
    assert.equal(logged[0].swipe.releaseFilterMs, 190);
    assert.equal(logged[0].swipe.releaseWindowMs, 190);
    closeTo(logged[0].swipe.vx, -65 / 98 / 0.19);
    assert.equal(logged[0].trace.rows.length, 7);
    const { pivot, rows: loggedRows, contact } = logged[0].trace;
    assert.equal(contact.version, 1);
    assert.equal(contact.serverResult, 'stick');
    assert.equal(contact.edge.index, 1);
    assert.ok(contact.shadow.approachSpeed > 0);
    assert.equal(contact.timeMs, 700);
    assert.ok(pivot.headMass > pivot.handleMass && pivot.y > 5.5 && pivot.y < 10);
    assert.ok(pivot.inertia > 139 && pivot.inertia < 141);
    const center = ([, , x, , z, , qx, qy, qz, qw]) => {
      const bladeZ = Number(z) * 98;
      const ox = pivot.x * 1.4, oy = -pivot.y * 0.74 * 1.4;
      return [
        Number(x) * 98 * (1 - bladeZ / 345) + (1 - 2 * (qy ** 2 + qz ** 2)) * ox + 2 * (qx * qy - qz * qw) * oy,
        bladeZ + 2 * (qx * qz - qy * qw) * ox + 2 * (qy * qz + qx * qw) * oy,
      ];
    };
    const firstCenter = center(loggedRows[2]), middleCenter = center(loggedRows[4]), lastCenter = center(loggedRows[6]);
    middleCenter.forEach((axis, i) => assert.ok(Math.abs(axis - (firstCenter[i] + lastCenter[i]) / 2) < 0.12));

    assert.ok(Number(logged[0].trace.rows.find((row) => row[1] === 'Release')[2]) > 0.54);
    assert.match(debug.querySelector('.ar-darts-axe-swipe-summary').textContent, /250 ms · 4 samples/);
    assert.match(debug.querySelector('.ar-darts-axe-log-status').textContent, /Throw saved/);
    render();
    assert.equal(logged.length, 1);

    darts.shot = { ...darts.shot, id: 17, x: 1, axeAngle: 0 };
    darts.darts.push(darts.shot);
    render();
    tick();
    assert.ok(!marker.hasAttribute('hidden'));
    assert.equal(marker.getAttribute('cx'), '223');
    const rimPoint = projectedPoint(axeBoard.querySelector('[data-shot="17"]'), centerEdge);
    closeTo(rimPoint[0], 223);
    closeTo(rimPoint[1], 125);

    const grab = document.querySelector('.ar-darts-axe-grab');
    const reset = document.querySelector('.ar-darts-axe-reset-position');
    axeBoard.getBoundingClientRect = () => ({ left: 0, top: 0, width: 250, height: 250 });
    const beforePlacement = actions.length;
    const [startX, startY] = grab.getAttribute('transform').match(/-?[\d.]+/g).map(Number);
    axePointer('pointerdown', startX, startY, 1980, grab);
    axePointer('pointerup', startX, startY, 1990);
    assert.ok(reset.disabled);

    axePointer('pointerdown', startX, startY, 2000, grab, 'touch');
    axePointer('pointermove', 75, 105, 2040, axeBoard, 'touch');
    axePointer('pointercancel', 75, 105, 2050, axeBoard, 'touch');
    tick();
    assert.ok(reset.disabled);

    axePointer('pointerdown', startX, startY, 2080, grab, 'touch');
    axePointer('pointermove', 75, 105, 2100, axeBoard, 'touch');
    axePointer('pointerdown', 90, 90, 2110, axeBoard, 'touch', 32);
    axePointer('pointerup', 75, 105, 2120, axeBoard, 'touch');
    axePointer('pointerup', 90, 90, 2130, axeBoard, 'touch', 32);
    assert.ok(reset.disabled);

    axePointer('pointerdown', startX, startY, 2150, grab);
    axePointer('pointermove', 75, 105, 2160);
    context.myTurn = false;
    render();
    axePointer('pointerup', 75, 105, 2170);
    context.myTurn = true;
    render();
    tick();
    assert.ok(reset.disabled);

    grab.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft', shiftKey: true }));
    tick();
    assert.match(debug.querySelector('.ar-darts-axe-readout').textContent, /^X 0.66/);
    reset.click();
    tick();

    axePointer('pointerdown', startX, startY, 2200, grab);
    axePointer('pointermove', -50, 105, 2400);
    tick();
    assert.match(debug.querySelector('.ar-darts-axe-readout').textContent, /^X -1.28/);
    axePointer('pointerup', 75, 105, 2600);
    tick();
    assert.equal(actions.length, beforePlacement);
    assert.match(debug.querySelector('.ar-darts-axe-readout').textContent, /^X -0.51 · Y 0.20/);
    axePointer('pointerdown', 200, 180, 2810);
    axePointer('pointermove', 190, 190, 2840);
    tick();
    assert.match(debug.querySelector('.ar-darts-axe-readout').textContent, /^X -0.61 · Y 0.10/);
    axePointer('pointerup', 190, 190, 2850);
    tick();
    const moved = grab.getAttribute('transform');
    axePointer('pointerdown', 175, 75, 2860);
    axePointer('pointerup', 175, 75, 2870);
    tick();
    assert.equal(grab.getAttribute('transform'), moved);
    assert.equal(actions.length, beforePlacement);
    axePointer('pointerdown', 75, 105, 2900, axeThrowButton);
    axePointer('pointerup', 80, 105, 2910);
    assert.equal(actions.length, beforePlacement);
    axePointer('pointerdown', 160, 130, 3000, axeBoard, 'touch');
    axePointer('pointermove', 170, 130, 3220, axeBoard, 'touch');
    axePointer('pointermove', 200, 126, 3260, axeBoard, 'touch');
    tick();
    assert.match(document.querySelector('.ar-darts-axe-live').textContent, /Ready to release/);
    axePointer('pointerup', 200, 126, 3270, axeBoard, 'touch');
    await new Promise(setImmediate);
    assert.equal(actions.length, beforePlacement + 1);
    const flick = actions.at(-1).payload;
    closeTo(flick.axeOrigin[0], (75 - 125) / 98);
    closeTo(flick.axeOrigin[1], (125 - 115) / 98);
    closeTo(flick.dx, 30 / 98);
    assert.ok(flick.vx > 2.2);

    axePointer('pointerdown', 100, 135, 3400, axeBoard, 'touch');
    axePointer('pointermove', 130, 135, 3440, axeBoard, 'touch');
    axePointer('pointerup', 130, 135, 3540, axeBoard, 'touch');
    assert.equal(actions.length, beforePlacement + 1);

    axePointer('pointerdown', 105, 115, 3600, axeThrowButton);
    axePointer('pointermove', 112, 118, 3690);
    axePointer('pointermove', 125, 125, 3760);
    axePointer('pointerup', 125, 125, 3770);
    await new Promise(setImmediate);
    assert.equal(actions.length, beforePlacement + 2);
    const placedThrow = actions.at(-1).payload;
    closeTo(placedThrow.axeOrigin[0] + placedThrow.dx, 0);
    closeTo(placedThrow.axeOrigin[1] + placedThrow.dy, 0);
    assert.ok(placedThrow.vx > 0);
  } finally {
    ui.unmount();
    window.close();
  }
}

test().then(() => console.log('Darts input passed')).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
