import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';


export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: { '@shared': new URL('./shared', import.meta.url).pathname },
  },
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: { port: 5173 },
});
