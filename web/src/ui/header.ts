import { FLUENT_CONFIGURED } from '../fluent';
import { state } from '../store';
import { h, icon } from './dom';

export interface HeaderHandlers {
  connectFluent(): void;
  openAccount(): void;
  disconnect(): void;
}

/** The Fluent Connect entry point: the widget handles Fluent ID login and External wallets. */
export function fluentButton(on: HeaderHandlers): HTMLElement {
  if (!FLUENT_CONFIGURED) {
    return h('span', {
      class: 'warn',
      text: 'Fluent Connect: set VITE_FLUENT_APP_ID and VITE_FLUENT_PRIVY_CLIENT_ID',
    });
  }
  // stays clickable while restoring: if the widget never finishes initializing, the player can still retry
  const pending = state.fluentStatus === 'connecting';
  return h(
    'button',
    {
      class: 'btn btn-primary btn-wallet',
      disabled: state.connecting,
      title: 'Sign in with a Fluent ID or connect a wallet',
      onclick: on.connectFluent,
    },
    icon('bobber'),
    pending ? 'Fluent…' : 'Connect with Fluent',
  );
}
