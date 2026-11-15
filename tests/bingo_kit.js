// Unit checks for static/games/bingokit.js's pure helpers (what the real-life 🔵 Bingo tools rely on).
//   node tests/bingo_kit.js
const K = require('../static/games/bingokit.js');

let fails = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? `  (${detail})` : ''}`);
  if (!ok) fails++;
}
const daubs = (cells) => { const d = Array(25).fill(false); d[12] = true; for (const c of cells) d[c] = true; return d; };

// parsing what the caller says
check('parse: "B12"', K.parseCall('B12') === 12);
check('parse: "b 12"', K.parseCall('b 12') === 12);
check('parse: "12"', K.parseCall('12') === 12);
check('parse: "G-52"', K.parseCall('G-52') === 52);
check('parse: letter must match', K.parseCall('B52') === null);
check('parse: out of range', K.parseCall('76') === null && K.parseCall('0') === null);
check('parse: junk', K.parseCall('hello') === null && K.parseCall('') === null);

// wins
check('line: a row', K.wins(daubs([0, 1, 2, 3, 4]), 'line')?.keys[0] === 'r0');
check('line: the FREE centre helps', !!K.wins(daubs([10, 11, 13, 14]), 'line'));
check('line: four of a row is not a line', K.wins(daubs([0, 1, 2, 3]), 'line') === null);
check('two: needs two lines', K.wins(daubs([0, 1, 2, 3, 4]), 'two') === null && !!K.wins(daubs([0, 1, 2, 3, 4, 20, 21, 22, 23, 24]), 'two'));
check('corners', !!K.wins(daubs([0, 4, 20, 24]), 'corners') && !K.wins(daubs([0, 4, 20]), 'corners'));
check('blackout', !!K.wins(daubs([...Array(25).keys()]), 'blackout') && !K.wins(daubs([...Array(24).keys()]), 'blackout'));
check('stamp: any corner', !!K.wins(daubs([18, 19, 23, 24]), 'stamp'));
check('X shape', !!K.wins(daubs([0, 6, 18, 24, 4, 8, 16, 20]), 'x'));
check('custom pattern', !!K.wins(daubs([1, 3]), { custom: [1, 3, 12] }) && !K.wins(daubs([1]), { custom: [1, 3] }));
check('unknown pattern', K.wins(daubs([]), 'nope') === null);

// one to go
check('one to go: the missing cell of a row', K.oneToGo(daubs([0, 1, 2, 3]), 'line').includes(4));
check('one to go: corners', K.oneToGo(daubs([0, 4, 20]), 'corners').join() === '24');
check('one to go: two lines waits for the first', K.oneToGo(daubs([0, 1, 2, 3]), 'two').length === 0);

// checking a typed/scanned card
const good = [1, 16, 31, 46, 61, 2, 17, 32, 47, 62, 3, 18, 0, 48, 63, 4, 19, 33, 49, 64, 5, 20, 34, 50, 65];
let r = K.checkCard(good);
check('card: a good card', r.bad.size === 0 && r.dup.size === 0 && r.empty.length === 0);
const bad = good.slice(); bad[0] = 20; bad[1] = 17;
r = K.checkCard(bad);
check('card: out of its column', r.bad.has(0));
check('card: duplicates', r.dup.has(1) && r.dup.has(6));
const gap = good.slice(); gap[3] = null;
check('card: empty cells listed', K.checkCard(gap).empty.join() === '3');

console.log(fails ? `\n${fails} failed` : '\nall ok');
process.exit(fails ? 1 : 0);
