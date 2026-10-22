import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    // Native file events are not delivered for this folder on macOS (Desktop is a protected location),
    // so without polling the dev server keeps serving stale modules after edits.
    watch: { usePolling: true, interval: 300 },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1000 },
});
