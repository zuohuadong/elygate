import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/enterprise/',
  plugins: [
    tailwindcss(),
    svelte(),
  ],
  server: {
    port: 5175,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: [
      '@tanstack/svelte-query',
      '@elygate/enterprise-contracts',
      '@elygate/enterprise-authz',
    ],
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@svadmin/ui')) return 'svadmin-ui';
          if (id.includes('@svadmin/core')) return 'svadmin-core';
          if (id.includes('@svadmin/')) return 'svadmin-providers';
          if (id.includes('@tanstack/')) return 'tanstack';
          if (id.includes('/svelte/')) return 'svelte';
          return undefined;
        },
      },
    },
  },
  resolve: {
    dedupe: ['svelte', '@tanstack/svelte-query'],
  },
});
