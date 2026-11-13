/** A pixel-styled dropdown that replaces the native <select>: a button plus a listbox, keyboard included. */
import { h } from './dom';

export interface DropdownOption {
  value: string;
  label: string;
  /** Short secondary text on the right, e.g. "42 casts". */
  hint?: string;
}

interface Opts {
  /** Accessible name of the control. */
  label: string;
  value: string;
  options: DropdownOption[];
  onPick: (value: string) => void;
  disabled?: boolean;
  small?: boolean;
}

let closeOpen: (() => void) | null = null;

export function dropdown(o: Opts): HTMLElement {
  const current = o.options.find((x) => x.value === o.value) ?? o.options[0];
  const btn = h(
    'button',
    { class: 'dd-btn', disabled: o.disabled, attrs: { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': `${o.label}: ${current?.label ?? ''}` } },
    h('span', { class: 'dd-value', text: current?.label ?? '' }),
    current?.hint ? h('span', { class: 'dd-hint', text: current.hint }) : null,
    h('span', { class: 'dd-caret', attrs: { 'aria-hidden': 'true' } }),
  );
  const items = o.options.map((x) =>
    h(
      'button',
      {
        class: `dd-opt${x.value === current?.value ? ' sel' : ''}`,
        attrs: { type: 'button', role: 'option', 'aria-selected': String(x.value === current?.value) },
        onclick: () => {
          close();
          if (x.value !== current?.value) o.onPick(x.value);
          else btn.focus();
        },
      },
      h('span', { class: 'dd-mark', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'dd-value', text: x.label }),
      x.hint ? h('span', { class: 'dd-hint', text: x.hint }) : null,
    ),
  );
  const menu = h('div', { class: 'dd-menu', attrs: { role: 'listbox', 'aria-label': o.label } }, items);
  const root = h('div', { class: `dd${o.small ? ' dd-sm' : ''}` }, btn, menu);

  const outside = (e: Event): void => {
    if (!root.contains(e.target as Node)) close();
  };
  function close(): void {
    if (!root.classList.contains('open')) return;
    root.classList.remove('open', 'up');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (closeOpen === close) closeOpen = null;
  }
  function open(): void {
    closeOpen?.();
    root.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    // flip upward when there is no room below
    const r = btn.getBoundingClientRect();
    root.classList.toggle('up', window.innerHeight - r.bottom < menu.offsetHeight + 12 && r.top > menu.offsetHeight + 12);
    document.addEventListener('pointerdown', outside, true);
    closeOpen = close;
    (items.find((i) => i.classList.contains('sel')) ?? items[0])?.focus();
  }
  btn.addEventListener('click', () => (root.classList.contains('open') ? close() : open()));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open();
    }
  });
  menu.addEventListener('keydown', (e) => {
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      btn.focus();
    } else if (e.key === 'Tab') close();
  });
  return root;
}
