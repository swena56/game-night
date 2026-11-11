// Solitaire (Klondike): the stock and the waste, then four foundations across the top, seven columns
// below (static/patience.js does the drawing and the dragging; games/klondike.py is the referee).
UI.klondike = Patience.screen({
  key: 'klondike', prefix: 'kl', cols: 7, icon: '♣️', maxCw: 92, kingsOnly: true, foundationBack: true,
  drawTop(top, { B, slot, cardNode, Cards }) {
    // the stock: tap to turn cards over; when it's empty, ↻ turns the waste back over
    const st = slot('s', 'pt-stock' + (B.stock ? '' : ' empty'));
    if (B.stock) {
      const back = Cards.back('pt-card', B.stock);
      back.dataset.pile = 's';
      st.append(back);
    } else if (B.wasted) st.append(document.createTextNode('↻'));
    top.append(st);
    // the waste: drawing three, the last three cards fanned; drawing one, a plain pile. Only the top one plays
    const w = slot('w', 'pt-waste' + (B.draw === 3 ? ' three' : ''));
    const shown = B.draw === 3 ? B.waste : B.waste.slice(-2);
    shown.forEach((c, i) => {
      const n = cardNode(c, 'w', 0);
      if (B.draw === 3) n.style.left = `calc(var(--cw) * ${(i * 0.32).toFixed(2)})`;
      if (i < shown.length - 1) { delete n.dataset.pile; n.classList.add('pt-dim'); }
      w.append(n);
    });
    top.append(w);
  },
  note(v) {
    const b = v.board;
    return `Stock ${b.stock} · drawing ${b.draw}` + (b.passes ? ` · pass ${b.passes + 1}` : '');
  },
});
