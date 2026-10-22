import { buyBait, buyRod, refillEnergy, repairRod, upgradeRod } from '../actions';
import { cfg, cfgBig, emit, selectedRod, state } from '../store';
import { fmtToken, h, mount, sigOf } from './dom';

const amounts = new Map<number, number>();

/** Disable the button while the tx runs; errors are toasted by sendTx. */
function run(fn: () => Promise<unknown>) {
  return (e: MouseEvent): void => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    fn()
      .catch(() => undefined)
      .finally(() => (b.disabled = false));
  };
}

export function initShop(host: HTMLElement): () => void {
  return mount(
    host,
    () => sigOf(!!state.wallet, state.pearl, state.baits, state.baitBalance, state.refillPrice, state.energy, state.rods, state.sel.rod, state.config),
    render,
  );
}

function render(): HTMLElement[] {
  if (!state.wallet) return [h('p', { class: 'muted', text: 'Connect a wallet to shop.' })];
  const pearl = state.pearl;
  const out: HTMLElement[] = [];

  // baits
  out.push(
    h(
      'section',
      { class: 'shop-sec' },
      h('h3', { text: 'Bait' }),
      state.baits
        .filter((b) => b.id !== 0)
        .map((b) => {
          const amount = amounts.get(b.id) ?? 10;
          const costEl = h('span', { class: 'pearl', text: `${fmtToken(b.price * BigInt(amount))} PEARL` });
          const buyBtn = h('button', {
            class: 'btn btn-sm',
            text: 'Buy',
            disabled: b.price * BigInt(amount) > pearl,
            onclick: run(() => buyBait(b.id, BigInt(amounts.get(b.id) ?? 10))),
          });
          const input = h('input', {
            class: 'num',
            attrs: { type: 'number', min: '1', max: '1000', step: '1', value: String(amount), 'aria-label': 'Quantity' },
            oninput: (e) => {
              const v = Math.max(1, Math.min(1000, Math.floor(Number((e.target as HTMLInputElement).value) || 1)));
              amounts.set(b.id, v);
              costEl.textContent = `${fmtToken(b.price * BigInt(v))} PEARL`;
              buyBtn.disabled = b.price * BigInt(v) > state.pearl;
            },
          });
          return h(
            'div',
            { class: 'shop-row' },
            h(
              'div',
              { class: 'shop-desc' },
              h('b', { text: b.name }),
              h('span', { class: 'muted small', text: `+${b.catchBonusBps / 100}% bite · +${b.rarityBonus}% rarity · ${fmtToken(b.price)} each · you have ×${state.baitBalance[b.id] ?? 0n}` }),
            ),
            h('div', { class: 'shop-act' }, input, costEl, buyBtn),
          );
        }),
    ),
  );

  // energy + rod
  const max = cfg('maxEnergy');
  out.push(
    h(
      'section',
      { class: 'shop-sec' },
      h('h3', { text: 'Gear' }),
      h(
        'div',
        { class: 'shop-row' },
        h(
          'div',
          { class: 'shop-desc' },
          h('b', { text: 'Refill energy' }),
          h('span', { class: 'muted small', text: `Up to ${max}. Now ${state.energy}/${max}. Each further refill within a day may cost more.` }),
        ),
        h(
          'div',
          { class: 'shop-act' },
          h('span', { class: 'pearl', text: `${fmtToken(state.refillPrice)} PEARL` }),
          h('button', {
            class: 'btn btn-sm',
            text: 'Refill',
            disabled: state.refillPrice > pearl || state.energy >= max,
            onclick: run(refillEnergy),
          }),
        ),
      ),
      h(
        'div',
        { class: 'shop-row' },
        h('div', { class: 'shop-desc' }, h('b', { text: 'New rod' }), h('span', { class: 'muted small', text: `Level 1, durability ${cfg('starterDurability')}` })),
        h(
          'div',
          { class: 'shop-act' },
          h('span', { class: 'pearl', text: `${fmtToken(cfgBig('rodPrice'))} PEARL` }),
          h('button', { class: 'btn btn-sm', text: 'Buy', disabled: cfgBig('rodPrice') > pearl, onclick: run(buyRod) }),
        ),
      ),
    ),
  );

  // selected rod: upgrade / repair
  const rod = selectedRod();
  const rodSec = h('section', { class: 'shop-sec' }, h('h3', { text: 'Workshop' }));
  if (state.rods.length > 1) {
    const sel = h('select', {
      class: 'select',
      attrs: { 'aria-label': 'Rod' },
      onchange: (e) => {
        state.sel.rod = BigInt((e.target as HTMLSelectElement).value);
        emit();
      },
    });
    for (const r of state.rods) {
      const o = h('option', { text: `Rod #${r.id} · lvl ${r.level} · ${r.durability}/${r.maxDurability}`, attrs: { value: r.id.toString() } });
      if (r.id === state.sel.rod) o.selected = true;
      sel.append(o);
    }
    rodSec.append(sel);
  }
  if (!rod) {
    rodSec.append(h('p', { class: 'muted', text: 'No rod.' }));
  } else {
    const maxLevel = cfg('maxRodLevel');
    const minRepair = cfg('minRepairLevel');
    const atMax = rod.upgradeCost === 0n;
    const canRepairLevel = rod.level >= minRepair;
    const full = rod.durability === rod.maxDurability;
    rodSec.append(
      h(
        'div',
        { class: 'shop-row' },
        h(
          'div',
          { class: 'shop-desc' },
          h('b', { text: `Upgrade #${rod.id}: lvl ${rod.level} → ${atMax ? rod.level : rod.level + 1}` }),
          h('span', {
            class: 'muted small',
            text: atMax ? `Max level (${maxLevel})` : `+${cfg('durabilityPerLevel')} durability, full repair, new spots`,
          }),
        ),
        h(
          'div',
          { class: 'shop-act' },
          h('span', { class: 'pearl', text: atMax ? '—' : `${fmtToken(rod.upgradeCost)} PEARL` }),
          h('button', {
            class: 'btn btn-sm',
            text: 'Upgrade',
            disabled: atMax || rod.locked || rod.upgradeCost > pearl,
            onclick: run(() => upgradeRod(rod.id)),
          }),
        ),
      ),
      h(
        'div',
        { class: 'shop-row' },
        h(
          'div',
          { class: 'shop-desc' },
          h('b', { text: `Repair #${rod.id}: ${rod.durability}/${rod.maxDurability}` }),
          h('span', {
            class: canRepairLevel ? 'muted small' : 'warn small',
            text: canRepairLevel
              ? full
                ? 'Rod is in full condition'
                : 'Fully restores durability'
              : `This rod cannot be repaired — upgrade it (repair from lvl ${minRepair})`,
          }),
        ),
        h(
          'div',
          { class: 'shop-act' },
          h('span', { class: 'pearl', text: full || !canRepairLevel ? '—' : `${fmtToken(rod.repairCost)} PEARL` }),
          h('button', {
            class: 'btn btn-sm',
            text: 'Repair',
            disabled: !canRepairLevel || full || rod.locked || rod.repairCost > pearl,
            onclick: run(() => repairRod(rod.id)),
          }),
        ),
      ),
    );
    if (rod.locked) rodSec.append(h('p', { class: 'muted small', text: 'Rod is in the water — wait for the cast to finish.' }));
  }
  out.push(rodSec);
  return out;
}
