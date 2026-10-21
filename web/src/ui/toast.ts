let host: HTMLElement | null = null;

export function toast(text: string, kind: 'ok' | 'err' | 'info' = 'info', ms = 4200): void {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = text;
  el.addEventListener('click', () => el.remove());
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }, ms);
}
