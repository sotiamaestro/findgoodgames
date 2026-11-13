import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

/** Inline the single CSS bundle into index.html so first paint does not wait on a stylesheet request. */
function inlineCss(): Plugin {
  return {
    name: 'inline-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const html = Object.values(bundle).find((b) => b.type === 'asset' && b.fileName === 'index.html');
      if (!html || html.type !== 'asset') return;
      let source = String(html.source);
      for (const [name, asset] of Object.entries(bundle)) {
        if (asset.type !== 'asset' || !name.endsWith('.css')) continue;
        const tag = new RegExp(`<link[^>]+href="/${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
        if (!tag.test(source)) continue;
        source = source.replace(tag, `<style>${String(asset.source)}</style>`);
        delete bundle[name];
      }
      html.source = source;
    },
  };
}

export default defineConfig({
  plugins: [preact(), inlineCss()],
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
