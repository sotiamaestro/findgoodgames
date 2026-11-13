import type { CheckResult, Game } from '@shared/types';

/** Steam appid from a store URL, steam:// link, or a bare number. */
export function parseAppId(input: string): number | null {
  const s = input.trim();
  if (/^\d{2,9}$/.test(s)) return Number(s);
  const m = s.match(/(?:store\.steampowered\.com\/app\/|steamcommunity\.com\/app\/|steam:\/\/store\/|s\.team\/a\/)(\d+)/i);
  return m ? Number(m[1]) : null;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Dataset name search: exact, then prefix, then word match. */
export function searchDataset(games: Game[], query: string, limit = 8): Game[] {
  const q = norm(query);
  if (!q) return [];
  const exact: Game[] = [];
  const prefix: Game[] = [];
  const contains: Game[] = [];
  for (const g of games) {
    const n = norm(g.name);
    if (n === q) exact.push(g);
    else if (n.startsWith(q)) prefix.push(g);
    else if (n.includes(q)) contains.push(g);
  }
  const byPop = (a: Game, b: Game) => b.rev.pos + b.rev.neg - (a.rev.pos + a.rev.neg);
  return [...exact.sort(byPop), ...prefix.sort(byPop), ...contains.sort(byPop)].slice(0, limit);
}

export type LiveMatch = { id: number; name: string; img: string | null };

export async function liveSearch(query: string): Promise<LiveMatch[]> {
  const res = await fetch(`/api/check-game?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`search failed (${res.status})`);
  const data = (await res.json()) as { matches?: LiveMatch[]; error?: string };
  if (data.error) throw new Error(data.error);
  return data.matches ?? [];
}

export async function liveCheck(appid: number): Promise<CheckResult> {
  const res = await fetch(`/api/check-game?appid=${appid}`);
  const data = (await res.json()) as CheckResult & { error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? `lookup failed (${res.status})`);
  return data;
}

export function fromDataset(g: Game): CheckResult {
  return {
    id: g.id,
    name: g.name,
    type: 'game',
    img: g.img,
    cap: g.cap,
    released: g.released,
    comingSoon: false,
    price: g.price,
    rev: { count: g.rev.pos + g.rev.neg, pct: g.rev.pct, label: g.rev.label },
    coop: g.coop,
    anyCoop: true,
    ea: g.ea,
    gfn: g.gfn.ok,
    adult: false,
    blurb: g.blurb,
    source: 'dataset',
  };
}
