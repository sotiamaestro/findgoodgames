import type { Game } from '@shared/types';
import { DEFAULT_FILTERS, LEFT_EA_DAYS, SORT_LABELS, isHiddenGem, type SortKey } from '@shared/config';

export type Mode = 'online' | 'local' | 'split' | 'lan';
export const MODES: Array<{ key: Mode; label: string }> = [
  { key: 'online', label: 'Online' },
  { key: 'local', label: 'Local' },
  { key: 'split', label: 'Split screen' },
  { key: 'lan', label: 'LAN' },
];

export type Filters = {
  maxPrice: number; // USD; 60 = no cap
  party: number; // 2..8 (8 = 8+)
  modes: Mode[];
  oneCopy: boolean;
  gfn: boolean;
  hideEa: boolean;
  minPct: number;
  minReviews: number;
  tags: string[];
  onSale: boolean;
  hideMmo: boolean;
  confirmedPlayers: boolean;
  sort: SortKey;
};

export const PRICE_CAP = 60;
export const PARTY_MAX = 8;
export const PCT_STEPS = [70, 80, 85, 90, 95];
export const REVIEW_STEPS = [100, 200, 500, 1000, 5000];

export function defaultFilters(): Filters {
  return { ...DEFAULT_FILTERS, modes: [], tags: [] };
}

// ---------------------------------------------------------------------------
// URL <-> filters. Only non-default values are written, so the bare URL is the default view.

const KEYS = {
  maxPrice: 'price',
  party: 'party',
  modes: 'modes',
  oneCopy: 'one',
  gfn: 'gfn',
  hideEa: 'ea',
  minPct: 'pct',
  minReviews: 'rev',
  tags: 'tags',
  onSale: 'sale',
  hideMmo: 'mmo',
  confirmedPlayers: 'conf',
  sort: 'sort',
} as const;

export function filtersFromParams(p: URLSearchParams): Filters {
  const d = defaultFilters();
  const num = (k: string, fallback: number, min: number, max: number) => {
    const v = Number(p.get(k));
    return p.has(k) && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  };
  const bool = (k: string, fallback: boolean) => (p.has(k) ? p.get(k) === '1' : fallback);
  const f: Filters = {
    maxPrice: num(KEYS.maxPrice, d.maxPrice, 0, PRICE_CAP),
    party: num(KEYS.party, d.party, 2, PARTY_MAX),
    modes: (p.get(KEYS.modes) ?? '').split(',').filter((m): m is Mode => MODES.some((x) => x.key === m)),
    oneCopy: bool(KEYS.oneCopy, d.oneCopy),
    gfn: bool(KEYS.gfn, d.gfn),
    hideEa: p.has(KEYS.hideEa) ? p.get(KEYS.hideEa) !== '1' : d.hideEa,
    minPct: num(KEYS.minPct, d.minPct, 0, 100),
    minReviews: num(KEYS.minReviews, d.minReviews, 0, 10_000_000),
    tags: (p.get(KEYS.tags) ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    onSale: bool(KEYS.onSale, d.onSale),
    hideMmo: p.has(KEYS.hideMmo) ? p.get(KEYS.hideMmo) !== '1' : d.hideMmo,
    confirmedPlayers: bool(KEYS.confirmedPlayers, d.confirmedPlayers),
    sort: (Object.keys(SORT_LABELS) as SortKey[]).includes(p.get(KEYS.sort) as SortKey) ? (p.get(KEYS.sort) as SortKey) : d.sort,
  };
  return f;
}

export function filtersToParams(f: Filters, into = new URLSearchParams()): URLSearchParams {
  const d = defaultFilters();
  const p = into;
  const set = (k: string, v: string | null) => (v == null ? p.delete(k) : p.set(k, v));
  set(KEYS.maxPrice, f.maxPrice !== d.maxPrice ? String(f.maxPrice) : null);
  set(KEYS.party, f.party !== d.party ? String(f.party) : null);
  set(KEYS.modes, f.modes.length ? f.modes.join(',') : null);
  set(KEYS.oneCopy, f.oneCopy ? '1' : null);
  set(KEYS.gfn, f.gfn !== d.gfn ? (f.gfn ? '1' : '0') : null);
  set(KEYS.hideEa, f.hideEa !== d.hideEa ? (f.hideEa ? '0' : '1') : null);
  set(KEYS.minPct, f.minPct !== d.minPct ? String(f.minPct) : null);
  set(KEYS.minReviews, f.minReviews !== d.minReviews ? String(f.minReviews) : null);
  set(KEYS.tags, f.tags.length ? f.tags.join(',') : null);
  set(KEYS.onSale, f.onSale ? '1' : null);
  set(KEYS.hideMmo, f.hideMmo !== d.hideMmo ? (f.hideMmo ? '0' : '1') : null);
  set(KEYS.confirmedPlayers, f.confirmedPlayers ? '1' : null);
  set(KEYS.sort, f.sort !== d.sort ? f.sort : null);
  return p;
}

export function isDefault(f: Filters): boolean {
  return filtersToParams(f).toString() === '';
}

// ---------------------------------------------------------------------------
// Applying filters

export function reviewTotal(g: Game): number {
  return g.rev.pos + g.rev.neg;
}

/** Which player count applies for the party-size check. */
export function playerCap(g: Game, f: Filters): number | null {
  if (!g.players) return null;
  const onlyLocal = f.oneCopy || (f.modes.length > 0 && f.modes.every((m) => m === 'local' || m === 'split'));
  if (onlyLocal) return g.players.local ?? null;
  return g.players.online ?? null;
}

export function passesBase(g: Game, f: Filters): boolean {
  if (f.maxPrice < PRICE_CAP && g.price.now > f.maxPrice * 100) return false;
  if (f.hideEa && g.ea) return false;
  if (f.gfn && !g.gfn.ok) return false;
  if (f.hideMmo && g.mmo) return false;
  return true;
}

export function passes(g: Game, f: Filters, tagIndex: Map<string, number>): boolean {
  if (!passesBase(g, f)) return false;
  if (g.rev.pct < f.minPct) return false;
  if (reviewTotal(g) < f.minReviews) return false;
  if (f.onSale && !(g.price.off > 0)) return false;
  if (f.oneCopy && !(g.coop.rpt && g.coop.local)) return false;
  if (f.modes.length && !f.modes.some((m) => g.coop[m])) return false;
  if (f.tags.length) {
    for (const t of f.tags) {
      const idx = tagIndex.get(t);
      if (idx == null || !g.tags.includes(idx)) return false;
    }
  }
  const cap = playerCap(g, f);
  if (cap == null) {
    if (f.confirmedPlayers) return false;
  } else if (f.party >= PARTY_MAX ? cap < PARTY_MAX : cap < f.party) {
    return false;
  }
  return true;
}

export function sortGames(games: Game[], sort: SortKey): Game[] {
  const arr = games.slice();
  const by: Record<SortKey, (a: Game, b: Game) => number> = {
    value: (a, b) => b.value - a.value,
    rated: (a, b) => b.rev.wilson - a.rev.wilson,
    cheapest: (a, b) => a.price.now - b.price.now || b.value - a.value,
    discount: (a, b) => b.price.off - a.price.off || b.value - a.value,
    newest: (a, b) => (a.released < b.released ? 1 : a.released > b.released ? -1 : b.value - a.value),
    reviewed: (a, b) => reviewTotal(b) - reviewTotal(a),
  };
  return arr.sort(by[sort]);
}

export function applyFilters(games: Game[], f: Filters, tagIndex: Map<string, number>): Game[] {
  return sortGames(games.filter((g) => passes(g, f, tagIndex)), f.sort);
}

// ---------------------------------------------------------------------------
// Home rows: each respects the GeForce NOW, Early Access and price settings.

export type RowDef = { key: string; label: string; title: string; editorial?: boolean; games: Game[] };

export function buildRows(games: Game[], f: Filters, now = Date.now()): RowDef[] {
  const base = games.filter((g) => passesBase(g, f));
  const cutoff = now - LEFT_EA_DAYS * 86400_000;
  const picks = base.filter((g) => g.pick).sort((a, b) => b.value - a.value);
  const gems = base.filter((g) => isHiddenGem(g)).sort((a, b) => b.value - a.value);
  const sale = base.filter((g) => g.price.off > 0 && reviewTotal(g) >= 200 && g.rev.pct >= 80).sort((a, b) => b.price.off - a.price.off || b.value - a.value);
  const leftEa = base
    .filter((g) => !g.ea && g.leftEaAt && Date.parse(g.leftEaAt) >= cutoff && reviewTotal(g) >= 200)
    .sort((a, b) => (a.leftEaAt! < b.leftEaAt! ? 1 : -1));
  return [
    { key: 'picks', label: 'Curated', title: 'Crew Picks', editorial: true, games: picks },
    { key: 'gems', label: '90%+, under 5,000 reviews, $15 or less', title: 'Hidden Gems', games: gems },
    { key: 'sale', label: 'Discounted right now', title: 'On Sale Now', games: sale },
    { key: 'leftea', label: `Full release in the last ${LEFT_EA_DAYS} days`, title: 'Just Left Early Access', games: leftEa },
  ].filter((r) => r.games.length > 0);
}

/** Price histogram buckets ($0-$1, $1-$5, ... $60+) over games passing everything except price. */
export function priceHistogram(games: Game[], f: Filters, tagIndex: Map<string, number>, buckets = 24): number[] {
  const relaxed: Filters = { ...f, maxPrice: PRICE_CAP };
  const counts = new Array<number>(buckets).fill(0);
  const step = PRICE_CAP / buckets;
  for (const g of games) {
    if (!passes(g, relaxed, tagIndex)) continue;
    const usd = g.price.now / 100;
    const i = Math.min(buckets - 1, Math.floor(usd / step));
    counts[i]!++;
  }
  return counts;
}

/** Weighted random pick: better value is more likely but anything can come up. */
export function weightedPick(games: Game[], exclude?: number): Game | null {
  const pool = games.filter((g) => g.id !== exclude);
  if (!pool.length) return games[0] ?? null;
  const min = Math.min(...pool.map((g) => g.value));
  const weights = pool.map((g) => Math.pow(g.value - min + 5, 2));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return pool[i]!;
  }
  return pool[pool.length - 1]!;
}

export function summarize(f: Filters): string[] {
  const out: string[] = [];
  out.push(f.maxPrice >= PRICE_CAP ? 'Any price' : f.maxPrice === 0 ? 'Free' : `Up to $${f.maxPrice}`);
  out.push(`${f.party >= PARTY_MAX ? '8+' : f.party} players`);
  if (f.modes.length) out.push(f.modes.map((m) => MODES.find((x) => x.key === m)!.label).join(' / '));
  if (f.oneCopy) out.push('1 copy');
  if (f.gfn) out.push('GeForce NOW');
  if (!f.hideEa) out.push('Early Access shown');
  out.push(`${f.minPct}%+`);
  out.push(`${f.minReviews.toLocaleString()}+ reviews`);
  if (f.onSale) out.push('On sale');
  if (!f.hideMmo) out.push('MMOs shown');
  if (f.confirmedPlayers) out.push('Confirmed counts');
  for (const t of f.tags) out.push(t);
  return out;
}
