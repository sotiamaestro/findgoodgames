// PCGamingWiki lookup: Steam appid -> max player counts, via wikitext.
// The Cargo API is closed to anonymous callers (see PROBE.md), so we read the
// pages themselves: 50 titles per request, verified against the infobox appid,
// with a text search per appid as the fallback.

import { rlFetch } from './http.ts';
import { modeExists, parseMultiplayer, parseSteamAppIds } from './pcgw.ts';

const API = 'https://www.pcgamingwiki.com/w/api.php';

export type Players = { online: number | null; local: number | null; lan: number | null };
export type PcgwResult = { page: string; players: Players | null };

type RevPage = { title: string; missing?: boolean; revisions?: Array<{ slots: { main: { content: string } } }> };
type RevResponse = { query?: { pages?: RevPage[]; redirects?: Array<{ from: string; to: string }>; normalized?: Array<{ from: string; to: string }> } };

export function normalizeTitle(name: string): string {
  return name
    .replace(/[™®©]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[|#<>[\]{}]/g, '')
    .trim();
}

async function fetchPages(titles: string[], log?: (l: string) => void): Promise<RevPage[]> {
  if (!titles.length) return [];
  const url = `${API}?action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(titles.join('|'))}`;
  const res = await rlFetch(url, { log, timeoutMs: 90_000 });
  if (!res.ok) throw new Error(`PCGW revisions HTTP ${res.status}`);
  const data = JSON.parse(res.text) as RevResponse;
  return data.query?.pages ?? [];
}

async function searchTitles(appid: number, log?: (l: string) => void): Promise<string[]> {
  const url = `${API}?action=query&list=search&srsearch=${appid}&srwhat=text&srlimit=5&format=json`;
  const res = await rlFetch(url, { log, timeoutMs: 60_000 });
  if (!res.ok) return [];
  try {
    const data = JSON.parse(res.text) as { query?: { search?: Array<{ title: string }> } };
    return (data.query?.search ?? []).map((s) => s.title);
  } catch {
    return [];
  }
}

function playersFromWikitext(wikitext: string): Players | null {
  const mp = parseMultiplayer(wikitext);
  if (!mp) return null;
  const pick = (m: { state: string | null; players: number | null }) => (modeExists(m.state) ? m.players : null);
  return { online: pick(mp.online), local: pick(mp.local), lan: pick(mp.lan) };
}

/**
 * Resolve many appids at once. `names` maps appid -> Steam name. Returns a map
 * of appid -> result for every appid that was resolved to a page (null players
 * when the page has no Multiplayer template). Appids with no page are absent.
 */
export async function lookupPlayers(
  names: Map<number, string>,
  opts: { log?: (l: string) => void; onProgress?: (done: number, total: number) => void; searchFallback?: boolean } = {},
): Promise<Map<number, PcgwResult>> {
  const { log, onProgress, searchFallback = true } = opts;
  const results = new Map<number, PcgwResult>();
  const byTitle = new Map<string, number[]>();
  for (const [appid, name] of names) {
    const t = normalizeTitle(name);
    if (!t) continue;
    const arr = byTitle.get(t.toLowerCase()) ?? [];
    arr.push(appid);
    byTitle.set(t.toLowerCase(), arr);
  }
  const titles = [...new Set([...names.values()].map(normalizeTitle).filter(Boolean))];
  const unresolved = new Set(names.keys());

  const absorb = (pages: RevPage[]) => {
    for (const p of pages) {
      if (p.missing || !p.revisions?.[0]) continue;
      const wt = p.revisions[0].slots.main.content;
      const ids = parseSteamAppIds(wt);
      const all = [ids.primary, ...ids.side].filter((n): n is number => n != null);
      for (const id of all) {
        if (unresolved.has(id)) {
          results.set(id, { page: p.title, players: playersFromWikitext(wt) });
          unresolved.delete(id);
        }
      }
    }
  };

  // Pass 1: titles in batches of 50.
  let done = 0;
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    try {
      absorb(await fetchPages(batch, log));
    } catch (err) {
      log?.(`pcgw batch failed: ${err instanceof Error ? err.message : err}`);
    }
    done += batch.length;
    onProgress?.(done, titles.length + (searchFallback ? unresolved.size : 0));
  }

  // Pass 2: one text search per unresolved appid, then fetch the candidates.
  if (searchFallback) {
    const pending = [...unresolved];
    let pendingTitles: Array<[number, string[]]> = [];
    const flush = async () => {
      const flat = [...new Set(pendingTitles.flatMap(([, t]) => t))];
      for (let i = 0; i < flat.length; i += 50) {
        try {
          absorb(await fetchPages(flat.slice(i, i + 50), log));
        } catch (err) {
          log?.(`pcgw candidate batch failed: ${err instanceof Error ? err.message : err}`);
        }
      }
      pendingTitles = [];
    };
    for (let i = 0; i < pending.length; i++) {
      const appid = pending[i]!;
      const hits = await searchTitles(appid, log);
      if (hits.length) pendingTitles.push([appid, hits.slice(0, 3)]);
      if (pendingTitles.length >= 16) await flush();
      onProgress?.(titles.length + i + 1, titles.length + pending.length);
    }
    await flush();
  }
  return results;
}
