import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // 363 quotes is not a lot of anything; keep the output boring and cacheable.
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 800,
  },
});
