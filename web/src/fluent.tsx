/**
 * Fluent Connect (@fluent.xyz/connect) mounted as a small React island next to the vanilla app.
 *
 * The widget owns login (Fluent ID via Privy, or an External wallet through its own picker), the account
 * drawer and transaction review. The app talks to it through two things only:
 *   - `onChange` reports who is connected (status + address);
 *   - `fluentSend` executes a Batch operation for the connected account and returns the tx hash.
 * The app's own pixel buttons call `openFluentConnect` / `openFluentAccount`, so the widget's own button is hidden.
 */
import '@fluent.xyz/connect/styles.css';
import { FluentWidget, useFluentWidget, type FluentWidgetConfig } from '@fluent.xyz/connect';
import { Component, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Abi, Address, Hash } from 'viem';

export interface FluentCall {
  to: Address;
  abi: Abi;
  method: string;
  args: readonly unknown[];
  value?: bigint;
}

export interface FluentAccountState {
  status: 'restoring' | 'connecting' | 'connected' | 'disconnected';
  address?: Address;
  /** "smart" for a Fluent ID, "eoa" for an External wallet connected through the widget. */
  kind?: 'smart' | 'eoa';
}

const APP_ID: string | undefined = import.meta.env.VITE_FLUENT_APP_ID;
const PRIVY_CLIENT_ID: string | undefined = import.meta.env.VITE_FLUENT_PRIVY_CLIENT_ID;

/** Fluent Connect runs on Fluent itself; the network is fixed per build, never defaulted (see the package docs). */
const config: FluentWidgetConfig | null =
  APP_ID && PRIVY_CLIENT_ID ? { appId: APP_ID, privyClientId: PRIVY_CLIENT_ID, network: 'testnet' } : null;

export const FLUENT_CONFIGURED = config !== null;

interface Controls {
  openConnect(): void;
  openAccount(): void;
  disconnect(): Promise<void>;
  send(calls: FluentCall[], title: string): Promise<Hash>;
}
let controls: Controls | null = null;

export function openFluentConnect(): void {
  controls?.openConnect();
}
export function openFluentAccount(): void {
  controls?.openAccount();
}
export async function disconnectFluent(): Promise<void> {
  await controls?.disconnect();
}

/** Executes the calls as one Batch operation (one transaction for a Fluent ID) and returns its hash. */
export async function fluentSend(calls: FluentCall[], title: string): Promise<Hash> {
  if (!controls) throw new Error('Fluent Connect is not ready yet');
  return controls.send(calls, title);
}

function normStatus(s: string): FluentAccountState['status'] {
  return s === 'connected' || s === 'connecting' || s === 'restoring' ? s : 'disconnected';
}

function Bridge({ onChange }: { onChange: (s: FluentAccountState) => void }) {
  const ctx = useFluentWidget();
  const { status, widget, openConnect, openAccount, disconnect } = ctx;
  const address = widget.account.address as Address | undefined;
  const kind = widget.account.type === 'smart' || widget.account.type === 'eoa' ? widget.account.type : undefined;

  controls = {
    openConnect,
    openAccount,
    disconnect,
    async send(calls, title) {
      const op = widget.createBatchOp({
        reviewTitle: title,
        calls: calls.map((c) => ({ to: c.to, abi: c.abi, method: c.method, args: [...c.args], value: c.value })),
      });
      const result = await op.execute();
      return result.hash as Hash;
    },
  };

  useEffect(() => {
    const st = normStatus(status);
    onChange({ status: st, address: st === 'connected' ? address : undefined, kind });
  }, [status, address, kind, onChange]);
  return null;
}

class Boundary extends Component<{ onError: (m: string) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error instanceof Error ? error.message : String(error));
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Mounts the widget once into its own element (outside the vanilla app's re-rendered DOM). */
export function mountFluent(onChange: (s: FluentAccountState) => void, onError: (message: string) => void): void {
  if (!config) return;
  const host = document.createElement('div');
  host.id = 'fluent-connect-root';
  document.body.append(host);
  createRoot(host).render(
    <Boundary onError={onError}>
      <FluentWidget
        config={config}
        connectButton={false}
        renderHome={() => <Bridge onChange={onChange} />}
      />
    </Boundary>,
  );
}
