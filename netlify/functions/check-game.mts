// Check a game that is not in the dataset: live Steam store data plus the
// GeForce NOW appid list from the data branch. Must finish well inside the
// free plan's 10 second function timeout, so every upstream call gets an
// 8 second budget and the two independent calls run in parallel.

import type { Config, Context } from '@netlify/functions';
import { CAT, ADULT_DESCRIPTORS, DATA_REPO, EA_GENRE_ID } from '../../shared/config.ts';
import type { CheckResult } from '../../shared/types.ts';

const UPSTREAM_TIMEOUT_MS = 8000;
const UA = 'coop-finder-checker/0.1 (open-source co-op game finder)';
const ASSET_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Netlify-CDN-Cache-Control': 'public, s-maxage=21600',
  'Cache-Control': 'public, max-age=300',
};

let gfnCache: { at: number; ids: number[] } | null = null;

async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers ?? {}) } });
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

async function gfnIds(): Promise<number[] | null> {
  if (gfnCache && Date.now() - gfnCache.at < 6 * 3600_000) return gfnCache.ids;
  const urls = [`https://cdn.jsdelivr.net/gh/${DATA_REPO}@data/gfn-steam.json`, `https://raw.githubusercontent.com/${DATA_REPO}/data/gfn-steam.json`];
  for (const url of urls) {
    try {
      const ids = await fetchJson<number[]>(url);
      if (Array.isArray(ids) && ids.length > 100) {
        gfnCache = { at: Date.now(), ids };
        return ids;
      }
    } catch {
      /* try the next source */
    }
  }
  return null;
}

function hasSorted(ids: number[], id: number): boolean {
  let lo = 0;
  let hi = ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = ids[mid]!;
    if (v === id) return true;
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

function isoDate(unix: number | undefined): string | null {
  return unix && unix > 0 ? new Date(unix * 1000).toISOString().slice(0, 10) : null;
}

function clean(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

type RawItem = {
  id: number;
  success?: number;
  name?: string;
  type?: number;
  is_free?: boolean;
  is_early_access?: boolean;
  is_coming_soon?: boolean;
  content_descriptorids?: number[];
  categories?: { supported_player_categoryids?: number[]; feature_categoryids?: number[] };
  reviews?: { summary_filtered?: { review_count?: number; percent_positive?: number; review_score_label?: string } };
  basic_info?: { short_description?: string };
  assets?: { asset_url_format?: string; library_capsule?: string; header?: string };
  release?: { steam_release_date?: number; is_coming_soon?: boolean; is_early_access?: boolean };
  best_purchase_option?: { final_price_in_cents?: string; original_price_in_cents?: string; discount_pct?: number };
};

const TYPE_NAMES: Record<number, string> = { 0: 'game', 1: 'application', 2: 'tool', 3: 'demo', 4: 'dlc', 11: 'music', 13: 'video' };

function fromGetItems(it: RawItem, gfn: boolean): Omit<CheckResult, 'source'> {
  const cats = [...(it.categories?.supported_player_categoryids ?? []), ...(it.categories?.feature_categoryids ?? [])];
  const has = (c: number) => cats.includes(c);
  const local = has(CAT.SPLIT_COOP);
  const lan = has(CAT.LAN_COOP);
  const online = has(CAT.ONLINE_COOP) || (has(CAT.COOP) && !local && !lan);
  const anyCoop = has(CAT.COOP) || has(CAT.ONLINE_COOP) || has(CAT.SPLIT_COOP) || has(CAT.LAN_COOP);
  const asset = (f?: string) => (it.assets?.asset_url_format && f ? ASSET_BASE + it.assets.asset_url_format.replace('${FILENAME}', f) : null);
  const bpo = it.best_purchase_option;
  const free = it.is_free === true;
  const now = bpo?.final_price_in_cents != null ? Number(bpo.final_price_in_cents) : free ? 0 : null;
  const base = bpo?.original_price_in_cents != null ? Number(bpo.original_price_in_cents) : now;
  const sum = it.reviews?.summary_filtered;
  return {
    id: it.id,
    name: it.name ?? `App ${it.id}`,
    type: TYPE_NAMES[it.type ?? -1] ?? `type ${it.type}`,
    img: asset(it.assets?.header),
    cap: asset(it.assets?.library_capsule),
    released: isoDate(it.release?.steam_release_date),
    comingSoon: it.is_coming_soon === true || it.release?.is_coming_soon === true,
    price: now == null ? null : { now, base: base ?? now, off: bpo?.discount_pct ?? 0, free },
    rev: sum && sum.review_count ? { count: sum.review_count, pct: sum.percent_positive ?? 0, label: sum.review_score_label ?? '' } : null,
    coop: { online, local, lan, split: local, rpt: has(CAT.REMOTE_PLAY_TOGETHER) },
    anyCoop,
    ea: it.is_early_access === true || it.release?.is_early_access === true,
    gfn,
    adult: (it.content_descriptorids ?? []).some((d) => (ADULT_DESCRIPTORS as readonly number[]).includes(d)),
    blurb: clean(it.basic_info?.short_description ?? ''),
  };
}

type AppDetails = Record<string, { success: boolean; data?: Record<string, any> }>;

function fromAppDetails(id: number, d: Record<string, any>, gfn: boolean): Omit<CheckResult, 'source'> {
  const cats: number[] = (d.categories ?? []).map((c: { id: number }) => Number(c.id));
  const has = (c: number) => cats.includes(c);
  const local = has(CAT.SPLIT_COOP);
  const lan = has(CAT.LAN_COOP);
  const online = has(CAT.ONLINE_COOP) || (has(CAT.COOP) && !local && !lan);
  const po = d.price_overview;
  const free = d.is_free === true;
  return {
    id,
    name: d.name ?? `App ${id}`,
    type: d.type ?? 'unknown',
    img: d.header_image ?? null,
    cap: null,
    released: d.release_date?.date ? new Date(d.release_date.date).toISOString().slice(0, 10) : null,
    comingSoon: d.release_date?.coming_soon === true,
    price: po ? { now: po.final, base: po.initial, off: po.discount_percent ?? 0, free } : free ? { now: 0, base: 0, off: 0, free: true } : null,
    rev: d.recommendations?.total ? { count: d.recommendations.total, pct: 0, label: '' } : null,
    coop: { online, local, lan, split: local, rpt: has(CAT.REMOTE_PLAY_TOGETHER) },
    anyCoop: has(CAT.COOP) || has(CAT.ONLINE_COOP) || has(CAT.SPLIT_COOP) || has(CAT.LAN_COOP),
    ea: (d.genres ?? []).some((g: { id: string }) => Number(g.id) === EA_GENRE_ID),
    gfn,
    adult: (d.content_descriptors?.ids ?? []).some((x: number) => (ADULT_DESCRIPTORS as readonly number[]).includes(x)),
    blurb: clean(d.short_description ?? ''),
  };
}

async function lookupApp(appid: number): Promise<Response> {
  const input = {
    ids: [{ appid }],
    context: { language: 'english', country_code: 'US', steam_realm: 1 },
    data_request: { include_assets: true, include_release: true, include_ratings: true, include_reviews: true, include_basic_info: true },
  };
  const itemsP = fetchJson<{ response?: { store_items?: RawItem[] } }>(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`)
    .then((r) => r.response?.store_items?.[0] ?? null)
    .catch(() => null);
  const [item, ids] = await Promise.all([itemsP, gfnIds()]);
  const gfn = ids ? hasSorted(ids, appid) : false;
  let result: Omit<CheckResult, 'source'> | null = null;
  if (item && item.success !== 0 && item.name) {
    result = fromGetItems(item, gfn);
  } else {
    try {
      const d = await fetchJson<AppDetails>(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`);
      const entry = d[String(appid)];
      if (entry?.success && entry.data) result = fromAppDetails(appid, entry.data, gfn);
    } catch {
      /* handled below */
    }
  }
  if (!result) return new Response(JSON.stringify({ error: `Steam has no store page for app ${appid}.` }), { status: 404, headers: { ...JSON_HEADERS, 'Netlify-CDN-Cache-Control': 'public, s-maxage=600' } });
  const body: CheckResult & { gfnListUnavailable?: boolean } = { ...result, source: 'live' };
  if (!ids) body.gfnListUnavailable = true;
  return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
}

async function searchName(q: string): Promise<Response> {
  const data = await fetchJson<{ items?: Array<{ id: number; name: string; type: string; tiny_image?: string }> }>(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&cc=us&l=english`);
  const matches = (data.items ?? [])
    .filter((i) => i.type === 'app')
    .slice(0, 8)
    .map((i) => ({ id: i.id, name: i.name, img: i.tiny_image ?? null }));
  return new Response(JSON.stringify({ matches }), { status: 200, headers: JSON_HEADERS });
}

export default async (req: Request, _context: Context): Promise<Response> => {
  const url = new URL(req.url);
  const appid = Number(url.searchParams.get('appid'));
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  try {
    if (Number.isInteger(appid) && appid > 0) return await lookupApp(appid);
    if (q) return await searchName(q);
    return new Response(JSON.stringify({ error: 'Pass ?appid=<steam appid> or ?q=<game name>.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'upstream error';
    return new Response(JSON.stringify({ error: `Steam did not answer in time (${message}). Try again.` }), { status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
};

export const config: Config = { path: '/api/check-game' };
