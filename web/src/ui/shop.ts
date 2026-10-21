import { buyBait, buyRod, refillEnergy, repairRod, upgradeRod } from '../actions';
import { BAITS_RU, ru } from '../i18n';
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
  if (!state.wallet) return [h('p', { class: 'muted', text: 'Подключите кошелёк, чтобы делать покупки.' })];
  const pearl = state.pearl;
  const out: HTMLElement[] = [];

  // baits
  out.push(
    h(
      'section',
      { class: 'shop-sec' },
      h('h3', { text: 'Наживка' }),
      state.baits
        .filter((b) => b.id !== 0)
        .map((b) => {
          const amount = amounts.get(b.id) ?? 10;
          const costEl = h('span', { class: 'pearl', text: `${fmtToken(b.price * BigInt(amount))} PEARL` });
          const buyBtn = h('button', {
            class: 'btn btn-sm',
            text: 'Купить',
            disabled: b.price * BigInt(amount) > pearl,
            onclick: run(() => buyBait(b.id, BigInt(amounts.get(b.id) ?? 10))),
          });
          const input = h('input', {
            class: 'num',
            attrs: { type: 'number', min: '1', max: '1000', step: '1', value: String(amount), 'aria-label': 'Количество' },
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
              h('b', { text: ru(BAITS_RU, b.name) }),
              h('span', { class: 'muted small', text: `+${b.catchBonusBps / 100}% к поклёвке · +${b.rarityBonus}% к редкости · ${fmtToken(b.price)} за шт. · у вас ×${state.baitBalance[b.id] ?? 0n}` }),
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
      h('h3', { text: 'Снаряжение' }),
      h(
        'div',
        { class: 'shop-row' },
        h(
          'div',
          { class: 'shop-desc' },
          h('b', { text: 'Восстановить энергию' }),
          h('span', { class: 'muted small', text: `До ${max}. Сейчас ${state.energy}/${max}. Каждое следующее восстановление за сутки может стоить дороже.` }),
        ),
        h(
          'div',
          { class: 'shop-act' },
          h('span', { class: 'pearl', text: `${fmtToken(state.refillPrice)} PEARL` }),
          h('button', {
            class: 'btn btn-sm',
            text: 'Восстановить',
            disabled: state.refillPrice > pearl || state.energy >= max,
            onclick: run(refillEnergy),
          }),
        ),
      ),
      h(
        'div',
        { class: 'shop-row' },
        h('div', { class: 'shop-desc' }, h('b', { text: 'Новая удочка' }), h('span', { class: 'muted small', text: `Уровень 1, прочность ${cfg('starterDurability')}` })),
        h(
          'div',
          { class: 'shop-act' },
          h('span', { class: 'pearl', text: `${fmtToken(cfgBig('rodPrice'))} PEARL` }),
          h('button', { class: 'btn btn-sm', text: 'Купить', disabled: cfgBig('rodPrice') > pearl, onclick: run(buyRod) }),
        ),
      ),
    ),
  );

  // selected rod: upgrade / repair
  const rod = selectedRod();
  const rodSec = h('section', { class: 'shop-sec' }, h('h3', { text: 'Мастерская' }));
  if (state.rods.length > 1) {
    const sel = h('select', {
      class: 'select',
      attrs: { 'aria-label': 'Удочка' },
      onchange: (e) => {
        state.sel.rod = BigInt((e.target as HTMLSelectElement).value);
        emit();
      },
    });
    for (const r of state.rods) {
      const o = h('option', { text: `Удочка #${r.id} · ур. ${r.level} · ${r.durability}/${r.maxDurability}`, attrs: { value: r.id.toString() } });
      if (r.id === state.sel.rod) o.selected = true;
      sel.append(o);
    }
    rodSec.append(sel);
  }
  if (!rod) {
    rodSec.append(h('p', { class: 'muted', text: 'Нет удочки.' }));
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
          h('b', { text: `Улучшить #${rod.id}: ур. ${rod.level} → ${atMax ? rod.level : rod.level + 1}` }),
          h('span', {
            class: 'muted small',
            text: atMax ? `Максимальный уровень (${maxLevel})` : `+${cfg('durabilityPerLevel')} к прочности, полный ремонт, новые места`,
          }),
        ),
        h(
          'div',
          { class: 'shop-act' },
          h('span', { class: 'pearl', text: atMax ? '—' : `${fmtToken(rod.upgradeCost)} PEARL` }),
          h('button', {
            class: 'btn btn-sm',
            text: 'Улучшить',
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
          h('b', { text: `Починить #${rod.id}: ${rod.durability}/${rod.maxDurability}` }),
          h('span', {
            class: canRepairLevel ? 'muted small' : 'warn small',
            text: canRepairLevel
              ? full
                ? 'Удочка цела'
                : 'Восстанавливает прочность полностью'
              : `Эту удочку нельзя починить — улучшите её (ремонт с ур. ${minRepair})`,
          }),
        ),
        h(
          'div',
          { class: 'shop-act' },
          h('span', { class: 'pearl', text: full || !canRepairLevel ? '—' : `${fmtToken(rod.repairCost)} PEARL` }),
          h('button', {
            class: 'btn btn-sm',
            text: 'Починить',
            disabled: !canRepairLevel || full || rod.locked || rod.repairCost > pearl,
            onclick: run(() => repairRod(rod.id)),
          }),
        ),
      ),
    );
    if (rod.locked) rodSec.append(h('p', { class: 'muted small', text: 'Удочка в воде — дождитесь конца заброса.' }));
  }
  out.push(rodSec);
  return out;
}
