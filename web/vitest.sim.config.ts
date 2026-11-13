import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['sim/**/*.sim.ts'], environment: 'node' } });
