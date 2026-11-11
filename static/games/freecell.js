// FreeCell: four free cells and four foundations across the top, eight columns below (static/patience.js
// does the drawing and the dragging; games/freecell.py is the referee).
UI.freecell = Patience.screen({
  key: 'freecell', prefix: 'fc', cols: 8, icon: '🗃️', maxCw: 84,
  drawTop(top, { B, slot, cardNode }) {
    B.c.forEach((c, k) => {
      const s = slot(`c${k}`, 'pt-cell');
      if (c) s.append(cardNode(c, `c${k}`, 0));
      top.append(s);
    });
  },
  note(v) {
    const free = v.board.c.filter((x) => !x).length, empty = v.board.t.filter((c) => !c.length).length;
    const cap = (1 + free) * 2 ** empty;
    return `${free} free cell${free === 1 ? '' : 's'}${empty ? `, ${empty} empty column${empty === 1 ? '' : 's'}` : ''}: runs of ${cap} move in one go.`;
  },
});
