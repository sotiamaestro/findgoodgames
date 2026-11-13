import type { Dataset, Game } from '@shared/types';
import { DATA_REPO } from '@shared/config';

export const DATA_SOURCES = [
  `https://cdn.jsdelivr.net/gh/${DATA_REPO}@data/games.json`,
  `https://raw.githubusercontent.com/${DATA_REPO}/data/games.json`,
  '/data/games.fallback.json',
];

export type LoadedData = { dataset: Dataset; source: string; byId: Map<number, Game>; partial?: boolean };

/** The above-the-fold subset the build inlined into index.html, if any. */
export function readBootstrap(): LoadedData | null {
  try {
    const el = document.getElementById('bootstrap');
    if (!el?.textContent) return null;
    const dataset = JSON.parse(el.textContent) as Dataset;
    if (!Array.isArray(dataset.games) || !dataset.games.length) return null;
    return { dataset, source: 'bootstrap', byId: new Map(dataset.games.map((g) => [g.id, g])), partial: true };
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function loadDataset(): Promise<LoadedData> {
  let lastErr: unknown;
  for (const url of DATA_SOURCES) {
    try {
      const res = await fetchWithTimeout(url, 12_000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const dataset = (await res.json()) as Dataset;
      if (!Array.isArray(dataset.games) || !dataset.generatedAt) throw new Error('bad shape');
      return { dataset, source: url, byId: new Map(dataset.games.map((g) => [g.id, g])) };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('could not load games.json');
}

export function steamStoreUrl(id: number): string {
  return `https://store.steampowered.com/app/${id}/`;
}

export function steamAppUrl(id: number): string {
  return `steam://store/${id}`;
}
