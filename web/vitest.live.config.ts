import { defineConfig } from 'vitest/config';

// `pnpm live`: plays against the deployed contracts with the testnet deployer key from ../contracts/.env.
export default defineConfig({ test: { include: ['live/**/*.live.ts'], environment: 'node', testTimeout: 600_000, hookTimeout: 600_000 } });
