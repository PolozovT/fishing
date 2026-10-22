import { buyListing, cancelListing, listToken } from '../actions';
import { RARITY_CLASS, RARITY_NAMES } from '../i18n';
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
  if (l.fish) return `${state.species[l.fish.speciesId]?.name ?? ''} · ${fmtWeight(l.fish.weight)}`;
  if (l.rod) return `Rod lvl ${l.rod.level} · ${l.rod.durability}/${l.rod.maxDurability}`;
  return `#${l.tokenId}`;
}

function render(rerender: () => void): HTMLElement[] {
  const me = state.wallet?.address.toLowerCase();
  const out: HTMLElement[] = [];

  if (state.wallet) {
    const select = h('select', {
      class: 'select',
      attrs: { 'aria-label': 'Item to sell' },
      onchange: (e) => (draft.token = (e.target as HTMLSelectElement).value),
    });
    select.append(h('option', { text: '— choose a fish or rod —', attrs: { value: '' } }));
    for (const f of state.fish) {
      const v = `fish:${f.id}`;
      const o = h('option', {
        text: `Fish #${f.id}: ${state.species[f.speciesId]?.name ?? ''}, ${fmtWeight(f.weight)} (game pays ${fmtToken(f.value)})`,
        attrs: { value: v },
      });
      if (draft.token === v) o.selected = true;
      select.append(o);
    }
    for (const r of state.rods) {
      if (r.locked) continue;
      const v = `rod:${r.id}`;
      const o = h('option', { text: `Rod #${r.id}: lvl ${r.level}, ${r.durability}/${r.maxDurability}`, attrs: { value: v } });
      if (draft.token === v) o.selected = true;
      select.append(o);
    }
    if (draft.token && ![...select.options].some((o) => o.value === draft.token)) draft.token = '';
    const price = h('input', {
      class: 'num wide',
      attrs: { type: 'text', inputmode: 'decimal', placeholder: 'Price, PEARL', value: draft.price, 'aria-label': 'Price' },
      oninput: (e) => (draft.price = (e.target as HTMLInputElement).value),
    });
    out.push(
      h(
        'section',
        { class: 'shop-sec' },
        h('h3', { text: 'List for sale' }),
        h(
          'div',
          { class: 'list-form' },
          select,
          price,
          h('button', {
            class: 'btn btn-primary btn-sm',
            disabled: busy,
            text: busy ? 'Waiting…' : 'List',
            onclick: () => {
              const [kind, id] = draft.token.split(':');
              if (!kind || !id) return toast('Choose what to sell', 'err');
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
          text: `The NFT is held by the market until it sells or you cancel. A ${state.feeBps / 100}% fee is taken from the seller and burned. The first time, you need to approve the collection.`,
        }),
      ),
    );
  }

  const sec = h('section', { class: 'shop-sec' }, h('h3', { text: `Listings (${state.listings.length})` }));
  if (state.listings.length === 0) sec.append(h('p', { class: 'empty', text: 'The market is empty for now.' }));
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
            l.fish ? h('span', { class: `rarity ${RARITY_CLASS[rarity]}`, text: RARITY_NAMES[rarity] }) : h('span', { class: 'rarity', text: `Rod #${l.tokenId}` }),
            h('span', { class: 'item-meta' }, h('span', { class: 'pearl', text: `${fmtToken(l.price)} PEARL` }), h('span', { class: 'muted', text: mine ? 'your listing' : shortAddr(l.seller) })),
            !state.wallet
              ? null
              : mine
                ? h('button', { class: 'btn btn-ghost btn-sm', disabled: busy, text: 'Cancel', onclick: () => guard(rerender, () => cancelListing(l)) })
                : h('button', {
                    class: 'btn btn-sm',
                    disabled: busy || l.price > state.pearl,
                    text: l.price > state.pearl ? 'Not enough PEARL' : 'Buy',
                    onclick: () => guard(rerender, () => buyListing(l)),
                  }),
          );
        }),
      ),
    );
  out.push(sec);
  return out;
}
