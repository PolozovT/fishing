/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_CHAIN_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  ethereum?: {
    request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
    on?(event: string, handler: (...args: unknown[]) => void): void;
    removeListener?(event: string, handler: (...args: unknown[]) => void): void;
    isMetaMask?: boolean;
  };
}
