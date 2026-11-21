UI.ninetynine = CardTable.screen('ninetynine', {
  decorate(t, refs, ctx) {
    const plans = t.bidPlan || [];
    const panel = refs.hint.parentElement;
    let details = panel.querySelector('.nn-bid-plan');
    if (!details) {
      details = ctx.el('details', 'nn-bid-plan');
      details.append(ctx.el('summary', '', 'Plan your bid'));
      const label = ctx.el('label', '', 'Target tricks ');
      label.append(ctx.el('select'));
      details.append(label, ctx.el('p', 'hint left'));
      panel.append(details);
    }
    details.hidden = !plans.length;
    const key = JSON.stringify(plans);
    if (details.dataset.plans === key) return;
    details.dataset.plans = key;
    const select = details.querySelector('select');
    const previous = select.value;
    select.replaceChildren(...plans.map(({ bid }) => ctx.el('option', '', String(bid))));
    if (plans.some(({ bid }) => String(bid) === previous)) select.value = previous;
    const show = () => {
      const plan = plans[select.selectedIndex];
      details.lastElementChild.textContent = plan
        ? `Set aside ${plan.cards.join(' · ')}. The remaining hand is estimated to take ${plan.estimate.toFixed(1)} tricks.`
        : '';
    };
    select.onchange = show;
    show();
  },
});
