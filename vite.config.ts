import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2019',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: { manualChunks: { three: ['three'] } }
    }
  },
  server: { port: 3002 },
  // Allow the public tunnel hostname (DNS-rebinding protection would else 403 it).
  preview: { allowedHosts: ['.trycloudflare.com'] },
});
