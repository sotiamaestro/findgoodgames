import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { existsSync, readFileSync } from 'node:fs';

type BootGame = {
  id: number;
  img: string;
  cap: string | null;
  price: { now: number; off: number };
  rev: { pos: number; neg: number; pct: number };
  players: { online: number | null } | null;
  gfn: { ok: boolean };
  ea: boolean;
  leftEaAt: string | null;
  value: number;
  pick: string | null;
  pickRank: number | null;
  mmo: boolean;
};

/**
 * Inline the part of the bundled snapshot that the default home view paints
 * above the fold, so the first render (and the LCP image) does not wait for the
 * 1.7 MB games.json. The live file replaces it as soon as it arrives. The
 * filter rules here mirror src/lib/filters.ts for the default filters only.
 */
function bootstrapData(): Plugin {
  const file = new URL('./public/data/games.fallback.json', import.meta.url).pathname;
  return {
    name: 'bootstrap-data',
    transformIndexHtml(html) {
      if (!existsSync(file)) return html;
      const d = JSON.parse(readFileSync(file, 'utf8')) as { generatedAt: string; tagNames: string[]; games: BootGame[] };
      const n = (g: BootGame) => g.rev.pos + g.rev.neg;
      const base = d.games.filter((g) => !g.ea && g.gfn.ok && !g.mmo && g.price.now <= 2000);
      const grid = base
        .filter((g) => g.rev.pct >= 85 && n(g) >= 200 && (g.players?.online == null || g.players.online >= 4))
        .sort((a, b) => b.value - a.value)
        .slice(0, 36);
      const byValue = (a: BootGame, b: BootGame) => b.value - a.value;
      const cutoff = Date.now() - 90 * 86400_000;
      const picks = base.filter((g) => g.pick).sort((a, b) => (a.pickRank ?? 1e9) - (b.pickRank ?? 1e9) || b.value - a.value).slice(0, 12);
      const gems = base.filter((g) => g.rev.pct >= 90 && n(g) >= 200 && n(g) <= 5000 && g.price.now <= 1500).sort(byValue).slice(0, 12);
      const sale = base.filter((g) => g.price.off > 0 && n(g) >= 200 && g.rev.pct >= 80).sort((a, b) => b.price.off - a.price.off || b.value - a.value).slice(0, 12);
      const leftEa = base.filter((g) => g.leftEaAt && Date.parse(g.leftEaAt) >= cutoff && n(g) >= 200).sort((a, b) => (a.leftEaAt! < b.leftEaAt! ? 1 : -1)).slice(0, 12);
      const chosen = new Map<number, BootGame>();
      for (const g of [...picks, ...gems, ...sale, ...leftEa, ...grid]) chosen.set(g.id, g);
      const subset = { generatedAt: d.generatedAt, tagNames: d.tagNames, games: [...chosen.values()], partial: true };
      const json = JSON.stringify(subset).replace(/</g, '\\u003c');
      const lcp = picks[0]?.img ?? gems[0]?.cap ?? grid[0]?.cap;
      const preload = lcp ? `<link rel="preload" as="image" href="${lcp}" fetchpriority="high" />\n    ` : '';
      return html.replace('</head>', `    ${preload}<script id="bootstrap" type="application/json">${json}</script>\n  </head>`);
    },
  };
}

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
  plugins: [preact(), bootstrapData(), inlineCss()],
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
