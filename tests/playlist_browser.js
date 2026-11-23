// Run against a test server with BASE and CHROMIUM as in layout.js.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://localhost:8767';
const lineup = ['tictactoe', 'dropfour', 'tictactoe'];
const state = (page) => page.evaluate('S');
const wait = (page, predicate, arg) => page.waitForFunction(predicate, arg);
const act = (page, type, extra) => page.evaluate(
  ({ type, extra }) => window.act(type, extra), { type, extra }
);

async function checkPlaylist(browser) {
  const errors = [];
  const phone = { viewport: { width: 390, height: 720 }, reducedMotion: 'reduce' };
  const host = await browser.newPage(phone);
  const guest = await browser.newPage(phone);
  for (const page of [host, guest]) page.on('pageerror', (error) => errors.push(error.message));

  const click = (page, selector) => page.locator(selector).click();
  const getRequest = () => host.evaluate('playlistRequest()');
  const expectFit = async (page) => {
    const overflow = await page.evaluate(() => {
      if (document.documentElement.scrollWidth <= innerWidth + 1) return [];
      const elements = [...document.querySelectorAll('body *')].filter((e) => {
        const bounds = e.getBoundingClientRect();
        return bounds.width && bounds.right > innerWidth + 1 && !e.closest('.room-scoreboard');
      }).slice(0, 10).map((e) => e.closest('[id]')?.id || e.tagName);
      return [document.documentElement.scrollWidth, ...elements];
    });
    assert.deepEqual(overflow, [], 'phone layout scrolls sideways');
  };

  async function play(moves, type, key) {
    for (const move of moves) {
      const s = await state(host);
      const current = s.me.id === s.turn ? host : guest;
      await act(current, type, { [key]: move });
      await wait(host, (turn) => S.phase === 'over' || S.turn !== turn, s.turn);
    }
    await wait(host, () => S.phase === 'over');
    await wait(guest, () => S.phase === 'over');
  }

  await host.goto(BASE);
  await host.locator('#name').fill('Playlist Host');
  await click(host, '#createBtn');
  await host.locator('#lobbyCode').waitFor();
  await click(host, '#shareBtn');
  const invite = await host.locator('#modalBody input').inputValue();
  await click(host, '#modalOk');
  await guest.goto(new URL(new URL(invite).search, BASE).href);
  await guest.locator('#name').fill('Playlist Guest');
  await click(guest, '#joinBtn');
  await wait(host, () => S.players.length === 2);
  const seats = (await state(host)).players.map((p) => p.id);

  await act(host, 'settings', { settings: { game: 'tictactoe' } });
  await act(host, 'settings', { settings: { lucky: false } });
  await act(host, 'settings', { settings: { game: 'unmask' } });
  async function add(id, length) {
    await click(host, length === 1 ? '#buildPlaylistBtn' : '#addPlaylistGame');
    await expectFit(host);
    await host.locator(`#modalBody [data-game="${id}"]`).first().click();
    await wait(host, (n) => S.playlist?.games.length === n, length);
  }
  await add('tictactoe', 1);
  assert.ok(await host.locator('#startPlaylistBtn').isDisabled());
  await add('tictactoe', 2);
  await add('dropfour', 3);
  await click(host, '#playlistGames li:nth-child(3) button[aria-label^="Move up"]');
  await wait(host, () => S.playlist.games[1] === 'dropfour');
  await add('dropfour', 4);
  await wait(guest, () => S.playlist?.games.length === 4);
  await click(host, '#playlistGames li:nth-child(4) button[aria-label^="Remove"]');
  await wait(guest, () => S.playlist?.games.length === 3 && S.playlist.games[1] === 'dropfour');
  assert.deepEqual((await state(guest)).playlist.games, lineup);
  assert.equal(await guest.locator('#playlistGames button').count(), 0);
  await expectFit(host);
  const start = await getRequest();
  await click(host, '#startPlaylistBtn');

  for (const [i, game] of lineup.entries()) {
    for (const page of [host, guest]) {
      await wait(page, (i) => S.playlist?.index === i && S.phase === 'playing', i);
      const s = await state(page);
      assert.equal(s.gameId, game);
      assert.deepEqual(s.players.map((p) => p.id), seats);
      assert.equal(s.code, new URL(invite).searchParams.get('room'));
      if (game === 'tictactoe') assert.equal(s.settings.lucky, false);
    }
    if (game === 'tictactoe') await play([0, 3, 1, 4, 2], 'move', 'cell');
    else await play([0, 1, 0, 1, 0, 1, 0], 'drop', 'col');

    const s = await state(host);
    assert.equal(s.history.length, i + 1);
    assert.equal(s.players.reduce((sum, p) => sum + p.points, 0), 4 * (i + 1));
    assert.ok(await host.locator('#overScoreboard tr').count() > 1);
    assert.ok(await host.locator('#replayBtn').isVisible());
    assert.ok(await host.locator('#rematchBtn').isHidden());
    assert.ok(await guest.locator('#overVote').isHidden());
    assert.ok(await guest.locator('#playNextBtn').isHidden());
    await expectFit(host);

    const request = await getRequest();
    if (i === 0) {
      await assert.rejects(act(guest, 'next_playlist', request), /Only the host/);
      await assert.rejects(act(host, 'next_playlist', start), /playlist has changed/);
      await click(host, '#replayBtn');
      await host.locator('#replayBar').waitFor();
      await click(host, '#rpExit');
      await host.locator('#playNextBtn').waitFor();
      await click(guest, '#readyBtn');
      await wait(host, () => S.ready.length === 1);
      await Promise.all([host.reload(), guest.reload()]);
      await wait(host, () => S?.phase === 'over' && S.playlist.index === 0);
      await wait(guest, () => S?.phase === 'over' && S.playlist.index === 0);
    }
    if (i < lineup.length - 1) {
      await click(host, '#playNextBtn');
      await wait(host, (i) => S.playlist.index === i + 1, i);
      await assert.rejects(act(host, 'next_playlist', request), /Not right now|playlist has changed/);
    }
  }

  assert.equal(await host.locator('#overPlaylistTitle').textContent(), 'Playlist complete');
  assert.ok(await host.locator('#playNextBtn').isHidden());
  await click(host, '#lobbyBtn');
  await wait(host, () => S.phase === 'lobby' && !S.playlist);
  assert.equal((await state(host)).history.length, 3);
  await click(host, '#startBtn');
  await wait(host, () => S.phase === 'playing');
  await play([0, 3, 1, 4, 2], 'move', 'cell');
  assert.ok(await host.locator('#rematchBtn').isVisible());
  assert.ok(await guest.locator('#overVote').isVisible());
  await act(guest, 'next_vote', { game: 'dropfour' });
  await wait(host, () => Object.values(S.votes).includes('dropfour'));
  await click(host, '#rematchBtn');
  await wait(host, () => S.gameNo === 5 && S.phase === 'playing');
  await act(host, 'end_game');
  await wait(host, () => S.phase === 'lobby');
  await add('tictactoe', 1);
  await add('dropfour', 2);
  await click(host, '#startPlaylistBtn');
  await wait(host, () => S.phase === 'playing');
  await play([0, 3, 1, 4, 2], 'move', 'cell');
  const result = await state(host);
  await act(guest, 'leave');
  await wait(host, () => !!S.playlist.blocked);
  assert.match(await host.locator('#overPlaylistBlock').textContent(), /Drop Four needs/);
  assert.ok(await host.locator('#playNextBtn').isDisabled());
  assert.equal((await state(host)).playlist.index, 0);
  assert.deepEqual((await state(host)).history, result.history);
  await click(host, '#lobbyBtn');
  await wait(host, () => S.phase === 'lobby' && !S.playlist);
  assert.deepEqual((await state(host)).history, result.history);
  assert.deepEqual(errors, []);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    await checkPlaylist(browser);
    console.log('Playlist browser checks passed');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
