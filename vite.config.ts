import { defineConfig } from 'vite';

export default defineConfig({
  // three.js plus the packing table make one ~800 kB chunk; that's expected here.
  build: { chunkSizeWarningLimit: 1000 },
});
