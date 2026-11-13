// Spoons on the shared card table: an alarm and a buzz the moment a spoon goes, so nobody misses the grab
UI.spoons = (() => {
  let seen = null;
  return CardTable.screen('spoons', {
    decorate(t, R, ctx) {
      if (t.stage === 'grab' && seen === 'pass' && t.mine) { ctx.sfx('alarm'); ctx.buzz?.(80); }
      seen = t.stage;
    },
  });
})();
