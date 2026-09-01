import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname),
  base: './',
  plugins: [svelte()],
  build: {
    outDir: resolve(import.meta.dirname, '../dist/web'),
    emptyOutDir: true,
  },
  server: {
    port: 5178,
    proxy: { '/api': 'http://localhost:8090' },
  },
});
