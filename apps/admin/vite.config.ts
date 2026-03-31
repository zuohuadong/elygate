import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte(),
  ],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ['@svadmin/core', '@svadmin/ui', '@svadmin/elysia', '@svadmin/simple-rest'],
    include: [
      '@tanstack/svelte-query',
    ],
  },
  resolve: {
    dedupe: ['svelte', '@tanstack/svelte-query'],
  },
});
