import { defineConfig } from 'vite';
import { resolve } from 'path';
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
    exclude: ['@svadmin/core', '@svadmin/ui', '@svadmin/elysia', '@svadmin/simple-rest', '@svadmin/editor'],
    include: [
      '@tanstack/svelte-query',
    ],
  },
  resolve: {
    dedupe: ['svelte', '@tanstack/svelte-query'],
    alias: [
      { find: /^@svadmin\/core$/, replacement: resolve(__dirname, '../../packages/svadmin-core/src/index.ts') },
      { find: /^@svadmin\/ui$/, replacement: resolve(__dirname, '../../packages/svadmin-ui/src/index.ts') },
      { find: /^@svadmin\/ui\/(.*)/, replacement: resolve(__dirname, '../../packages/svadmin-ui/src/$1') },
      { find: /^@svadmin\/elysia$/, replacement: resolve(__dirname, '../../packages/svadmin-elysia/src/index.ts') },
      { find: /^@svadmin\/simple-rest$/, replacement: resolve(__dirname, '../../packages/svadmin-simple-rest/src/index.ts') },
      { find: /^@svadmin\/editor$/, replacement: resolve(__dirname, '../../packages/svadmin-editor/src/index.ts') }
    ]
  },
});
