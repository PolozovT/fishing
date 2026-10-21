import { buyListing, cancelListing, listToken } from '../actions';
import { RARITY_CLASS, RARITY_RU, SPECIES_RU, ru } from '../i18n';
import { cachedImage, state, type Listing } from '../store';
import { fmtToken, fmtWeight, h, img, mount, shortAddr, sigOf } from './dom';
import { toast } from './toast';

const draft = { token: '', price: '' };
let busy = false;

export function initMarket(host: HTMLElement): () => void {
  const rerender = mount(
    host,
    () =>
      sigOf(
        state.wallet?.address,
        state.listings,
        state.fish.map((f) => f.id),
        state.rods.map((r) => [r.id, r.locked]),
        state.pearl,
        state.marketApproved,
        busy,
        state.listings.map((l) => !!cachedImage(l.collection, l.tokenId)),
      ),
    () => render(rerender),
  );
  return rerender;
}

function guard(rerender: () => void, fn: () => Promise<unknown>): void {
  busy = true;
  rerender();
  fn()
    .catch((e) => {
      // sendTx already toasted tx errors; validation errors from listToken are plain Errors
      if (!(e && typeof e === 'object' && 'original' in e)) toast(e instanceof Error ? e.message : String(e), 'err');
    })
    .finally(() => {
      busy = false;
      rerender();
    });
}

function listingTitle(l: Listing): string {
  if (l.fish) return `${ru(SPECIES_RU, state.species[l.fish.speciesId]?.name ?? '')} · ${fmtWeight(l.fish.weight)}`;
  if (l.rod) return `Удочка ур. ${l.rod.level} · ${l.rod.durability}/${l.rod.maxDurability}`;
  return `#${l.tokenId}`;
}

function render(rerender: () => void): HTMLElement[] {
  const me = state.wallet?.address.toLowerCase();
  const out: HTMLElement[] = [];

  if (state.wallet) {
    const select = h('select', {
      class: 'select',
      attrs: { 'aria-label': 'Что продать' },
      onchange: (e) => (draft.token = (e.target as HTMLSelectElement).value),
    });
    select.append(h('option', { text: '— выберите рыбу или удочку —', attrs: { value: '' } }));
    for (const f of state.fish) {
      const v = `fish:${f.id}`;
      const o = h('option', {
        text: `Рыба #${f.id}: ${ru(SPECIES_RU, state.species[f.speciesId]?.name ?? '')}, ${fmtWeight(f.weight)} (игра даёт ${fmtToken(f.value)})`,
        attrs: { value: v },
      });
      if (draft.token === v) o.selected = true;
      select.append(o);
    }
    for (const r of state.rods) {
      if (r.locked) continue;
      const v = `rod:${r.id}`;
      const o = h('option', { text: `Удочка #${r.id}: ур. ${r.level}, ${r.durability}/${r.maxDurability}`, attrs: { value: v } });
      if (draft.token === v) o.selected = true;
      select.append(o);
    }
    if (draft.token && ![...select.options].some((o) => o.value === draft.token)) draft.token = '';
    const price = h('input', {
      class: 'num wide',
      attrs: { type: 'text', inputmode: 'decimal', placeholder: 'Цена, PEARL', value: draft.price, 'aria-label': 'Цена' },
      oninput: (e) => (draft.price = (e.target as HTMLInputElement).value),
    });
    out.push(
      h(
        'section',
        { class: 'shop-sec' },
        h('h3', { text: 'Выставить на продажу' }),
        h(
          'div',
          { class: 'list-form' },
          select,
          price,
          h('button', {
            class: 'btn btn-primary btn-sm',
            disabled: busy,
            text: busy ? 'Ждём…' : 'Выставить',
            onclick: () => {
              const [kind, id] = draft.token.split(':');
              if (!kind || !id) return toast('Выберите, что продать', 'err');
              guard(rerender, async () => {
                await listToken(kind as 'fish' | 'rod', BigInt(id), draft.price);
                draft.token = '';
                draft.price = '';
              });
            },
          }),
        ),
        h('p', {
          class: 'muted small',
          text: `NFT переходит на хранение рынку до продажи или снятия. Комиссия ${state.feeBps / 100}% удерживается с продавца и сжигается. Первый раз нужно разрешение (approve) на коллекцию.`,
        }),
      ),
    );
  }

  const sec = h('section', { class: 'shop-sec' }, h('h3', { text: `Лоты (${state.listings.length})` }));
  if (state.listings.length === 0) sec.append(h('p', { class: 'empty', text: 'На рынке пока пусто.' }));
  else
    sec.append(
      h(
        'div',
        { class: 'grid' },
        state.listings.map((l) => {
          const mine = l.seller.toLowerCase() === me;
          const rarity = l.fish ? state.species[l.fish.speciesId]?.rarity ?? 0 : 0;
          return h(
            'div',
            { class: `item ${l.fish ? RARITY_CLASS[rarity] : ''}` },
            img(cachedImage(l.collection, l.tokenId), listingTitle(l)),
            h('span', { class: 'item-name', text: listingTitle(l) }),
            l.fish ? h('span', { class: `rarity ${RARITY_CLASS[rarity]}`, text: RARITY_RU[rarity] }) : h('span', { class: 'rarity', text: `Удочка #${l.tokenId}` }),
            h('span', { class: 'item-meta' }, h('span', { class: 'pearl', text: `${fmtToken(l.price)} PEARL` }), h('span', { class: 'muted', text: mine ? 'ваш лот' : shortAddr(l.seller) })),
            !state.wallet
              ? null
              : mine
                ? h('button', { class: 'btn btn-ghost btn-sm', disabled: busy, text: 'Снять', onclick: () => guard(rerender, () => cancelListing(l)) })
                : h('button', {
                    class: 'btn btn-sm',
                    disabled: busy || l.price > state.pearl,
                    text: l.price > state.pearl ? 'Мало PEARL' : 'Купить',
                    onclick: () => guard(rerender, () => buyListing(l)),
                  }),
          );
        }),
      ),
    );
  out.push(sec);
  return out;
}
