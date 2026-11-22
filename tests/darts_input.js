// Run with node tests/darts_input.js after installing the test dependencies.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');

async function test() {
  const { window } = new JSDOM('<main></main><aside></aside>', { runScripts: 'outside-only' });
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

    currentBoard.getBoundingClientRect = () => ({ left: 0, width: 250 });
    const count = actions.length;
    pointer('pointerdown', 110, 100);
    pointer('pointermove', 30, 190);
    pointer('pointerup', 30, 190);
    assert.equal(actions.length, count);
    assert.match(tabletop.style.transform, /rotateY\(-28deg\)/);
    inspect.click();
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
  } finally {
    ui.unmount();
    window.close();
  }
}

test().then(() => console.log('Darts keyboard input passed')).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
