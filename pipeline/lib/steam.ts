// Steam Web API helpers used by the pipeline and the checker function.

import { CAT, ADULT_DESCRIPTORS, COOP_TAG_IDS } from '../../shared/config.ts';
import { rlFetch } from './http.ts';

export const STEAM_CONTEXT = { language: 'english', country_code: 'US', steam_realm: 1 };

/** Everything we read from a store item. Keep in sync with compactItem(). */
export const DATA_REQUEST = {
  include_assets: true,
  include_release: true,
  include_platforms: false,
  include_all_purchase_options: false,
  include_screenshots: false,
  include_trailers: false,
  include_ratings: true,
  include_tag_count: 20,
  include_reviews: true,
  include_basic_info: true,
  include_supported_languages: false,
  include_full_description: false,
  include_included_items: false,
  include_assets_without_overrides: false,
  apply_user_filters: false,
  include_links: false,
};

export const PRICE_DATA_REQUEST = {
  include_release: true,
  include_all_purchase_options: false,
  include_ratings: true,
};

export const ASSET_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/';

/** Raw store item as returned by GetItems / Query (only the parts we touch). */
export type RawStoreItem = {
  id: number;
  appid?: number;
  success?: number;
  visible?: boolean;
  name?: string;
  type?: number;
  item_type?: number;
  is_free?: boolean;
  is_early_access?: boolean;
  is_coming_soon?: boolean;
  content_descriptorids?: number[];
  categories?: { supported_player_categoryids?: number[]; feature_categoryids?: number[]; controller_categoryids?: number[] };
  reviews?: { summary_filtered?: { review_count?: number; percent_positive?: number; review_score?: number; review_score_label?: string } };
  basic_info?: { short_description?: string };
  tagids?: number[];
  tags?: Array<{ tagid: number; weight: number }>;
  assets?: { asset_url_format?: string; library_capsule?: string; header?: string; main_capsule?: string };
  release?: {
    steam_release_date?: number;
    original_steam_release_date?: number;
    original_release_date?: number;
    is_coming_soon?: boolean;
    is_early_access?: boolean;
    release_from_early_access_date?: number;
    custom_release_date_message?: string;
  };
  best_purchase_option?: {
    final_price_in_cents?: string;
    original_price_in_cents?: string;
    discount_pct?: number;
    formatted_final_price?: string;
  };
};

/** The subset the pipeline keeps per app. */
export type StoreRecord = {
  id: number;
  name: string;
  type: number;
  comingSoon: boolean;
  released: string; // ISO date or ''
  ea: boolean;
  leftEaAt: string | null; // from release_from_early_access_date when Steam provides it
  free: boolean;
  priceNow: number | null; // cents; null when not purchasable (free, or no package)
  priceBase: number | null;
  off: number;
  reviewCount: number;
  reviewPct: number;
  reviewLabel: string;
  cats: number[]; // supported_player + feature category ids
  descriptors: number[];
  tagids: number[]; // ordered by weight
  cap: string | null;
  img: string | null;
  blurb: string;
};

export function assetUrl(assets: RawStoreItem['assets'], file: string | undefined): string | null {
  if (!assets?.asset_url_format || !file) return null;
  return ASSET_BASE + assets.asset_url_format.replace('${FILENAME}', file);
}

/** Steam shows release dates in Pacific time; use the same day so cards match the store page. */
export function isoDate(unix: number | undefined): string {
  if (!unix || unix <= 0) return '';
  return new Date(unix * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '') + '…';
}

export function compactItem(it: RawStoreItem): StoreRecord | null {
  if (!it || it.success === 0 || !it.name) return null;
  const rel = it.release ?? {};
  const bpo = it.best_purchase_option;
  const free = it.is_free === true;
  const priceNow = bpo?.final_price_in_cents != null ? Number(bpo.final_price_in_cents) : free ? 0 : null;
  const priceBase = bpo?.original_price_in_cents != null ? Number(bpo.original_price_in_cents) : priceNow;
  const cats = [...(it.categories?.supported_player_categoryids ?? []), ...(it.categories?.feature_categoryids ?? [])];
  return {
    id: it.id ?? it.appid!,
    name: it.name,
    type: it.type ?? -1,
    comingSoon: it.is_coming_soon === true || rel.is_coming_soon === true,
    released: isoDate(rel.steam_release_date) || isoDate(rel.original_steam_release_date),
    ea: it.is_early_access === true || rel.is_early_access === true,
    leftEaAt: isoDate(rel.release_from_early_access_date) || null,
    free,
    priceNow,
    priceBase,
    off: bpo?.discount_pct ?? 0,
    reviewCount: it.reviews?.summary_filtered?.review_count ?? 0,
    reviewPct: it.reviews?.summary_filtered?.percent_positive ?? 0,
    reviewLabel: it.reviews?.summary_filtered?.review_score_label ?? '',
    cats,
    descriptors: it.content_descriptorids ?? [],
    tagids: it.tagids ?? (it.tags ?? []).map((t) => t.tagid),
    cap: assetUrl(it.assets, it.assets?.library_capsule),
    img: assetUrl(it.assets, it.assets?.header) ?? assetUrl(it.assets, it.assets?.main_capsule),
    blurb: truncate(decodeEntities(it.basic_info?.short_description ?? ''), 160),
  };
}

export type CoopFlags = { online: boolean; local: boolean; lan: boolean; split: boolean; rpt: boolean };

/**
 * Co-op modes from Steam categories (and the Split Screen tag for the
 * split-screen distinction, which Steam's categories do not make).
 * A game that only carries the generic "Co-op" category is treated as online
 * co-op: see DECISIONS.md.
 */
export function coopFromCategories(cats: number[], tagids: number[] = []): CoopFlags {
  const has = (c: number) => cats.includes(c);
  const local = has(CAT.SPLIT_COOP);
  const lan = has(CAT.LAN_COOP);
  const online = has(CAT.ONLINE_COOP) || (has(CAT.COOP) && !local && !lan);
  return {
    online,
    local,
    lan,
    split: local && tagids.includes(10816),
    rpt: has(CAT.REMOTE_PLAY_TOGETHER),
  };
}

export function hasAnyCoop(cats: number[]): boolean {
  return cats.includes(CAT.COOP) || cats.includes(CAT.ONLINE_COOP) || cats.includes(CAT.SPLIT_COOP) || cats.includes(CAT.LAN_COOP);
}

export function isAdult(descriptors: number[]): boolean {
  return descriptors.some((d) => (ADULT_DESCRIPTORS as readonly number[]).includes(d));
}

// ---------------------------------------------------------------------------
// Requests

type GetItemsResponse = { response?: { store_items?: RawStoreItem[] } };

export async function getItems(appids: number[], dataRequest: Record<string, unknown> = DATA_REQUEST, log?: (l: string) => void): Promise<RawStoreItem[]> {
  const key = process.env.STEAM_API_KEY ? `key=${encodeURIComponent(process.env.STEAM_API_KEY)}&` : '';
  const input = { ids: appids.map((appid) => ({ appid })), context: STEAM_CONTEXT, data_request: dataRequest };
  const url = `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?${key}input_json=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await rlFetch(url, { log });
  if (!res.ok) throw new Error(`GetItems ${res.status}`);
  const data = JSON.parse(res.text) as GetItemsResponse;
  return data.response?.store_items ?? [];
}

type QueryResponse = { response?: { metadata?: { total_matching_records: number; start: number; count: number }; ids?: Array<{ appid: number }>; store_items?: RawStoreItem[] } };

/** One page of IStoreQueryService/Query for games carrying any of the given tags. */
export async function queryByTags(tagids: readonly number[], start: number, count: number, log?: (l: string) => void): Promise<{ total: number; items: RawStoreItem[] }> {
  const key = process.env.STEAM_API_KEY ? `key=${encodeURIComponent(process.env.STEAM_API_KEY)}&` : '';
  const input = {
    query: { start, count, sort: 1, filters: { type_filters: { include_games: true }, tagids_must_match: [{ tagids: [...tagids] }] } },
    context: STEAM_CONTEXT,
    data_request: DATA_REQUEST,
  };
  const url = `https://api.steampowered.com/IStoreQueryService/Query/v1/?${key}input_json=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await rlFetch(url, { log, timeoutMs: 120_000 });
  if (!res.ok) throw new Error(`Query ${res.status}`);
  const data = JSON.parse(res.text) as QueryResponse;
  return { total: data.response?.metadata?.total_matching_records ?? 0, items: data.response?.store_items ?? [] };
}

/** Walk every page of the co-op tag query. */
export async function allCoopTagged(log: (l: string) => void, limit?: number): Promise<Map<number, RawStoreItem>> {
  const out = new Map<number, RawStoreItem>();
  const pageSize = 500;
  let start = 0;
  let total = Infinity;
  while (start < total) {
    const { total: t, items } = await queryByTags(COOP_TAG_IDS, start, pageSize, log);
    total = t;
    for (const it of items) if (it.id) out.set(it.id, it);
    start += pageSize;
    log(`query page start=${start - pageSize} items=${items.length} total=${total} collected=${out.size}`);
    if (!items.length) break;
    if (limit && out.size >= limit) break;
  }
  return out;
}

export type ReviewTotals = { pos: number; neg: number; label: string };

/** Exact positive / negative totals, matching the store headline (Steam purchases, all languages). */
export async function getReviewTotals(appid: number, log?: (l: string) => void): Promise<ReviewTotals | null> {
  const input = { appid, languages: ['all'], filter: 1, review_type: 0, purchase_type: 0, num_per_page: 1, cursor: '*' };
  const url = `https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await rlFetch(url, { log, timeoutMs: 30_000 });
  if (!res.ok) return null;
  try {
    const q = (JSON.parse(res.text) as { response?: { query_summary?: { total_positive?: number; total_negative?: number; review_score_desc?: string } } }).response?.query_summary;
    if (!q || q.total_positive == null || q.total_negative == null) return null;
    return { pos: q.total_positive, neg: q.total_negative, label: q.review_score_desc ?? '' };
  } catch {
    return null;
  }
}

/** Fallback blurb for older store pages that carry no short_description in GetItems. */
export async function getAppDetailsBlurb(appid: number, log?: (l: string) => void): Promise<string | null> {
  const res = await rlFetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english&filters=basic`, { log, timeoutMs: 30_000 });
  if (!res.ok) return null;
  try {
    const d = (JSON.parse(res.text) as Record<string, { success: boolean; data?: { short_description?: string; about_the_game?: string } }>)[String(appid)];
    const text = d?.data?.short_description || d?.data?.about_the_game || '';
    return text ? truncate(decodeEntities(text), 160) : null;
  } catch {
    return null;
  }
}

export async function getTagNames(log?: (l: string) => void): Promise<Map<number, string>> {
  const res = await rlFetch('https://api.steampowered.com/IStoreService/GetTagList/v1/?language=english', { log });
  const data = JSON.parse(res.text) as { response?: { tags?: Array<{ tagid: number; name: string }> } };
  return new Map((data.response?.tags ?? []).map((t) => [t.tagid, t.name]));
}

export async function getCategoryNames(log?: (l: string) => void): Promise<Map<number, string>> {
  const res = await rlFetch('https://api.steampowered.com/IStoreBrowseService/GetStoreCategories/v1/?language=english', { log });
  const data = JSON.parse(res.text) as { response?: { categories?: Array<{ categoryid: number; display_name: string }> } };
  return new Map((data.response?.categories ?? []).map((c) => [c.categoryid, c.display_name]));
}

/** SteamSpy tag list -> appids (approximate review counts included). */
export async function steamSpyTag(tag: string, log?: (l: string) => void): Promise<Map<number, { positive: number; negative: number }>> {
  const res = await rlFetch(`https://steamspy.com/api.php?request=tag&tag=${encodeURIComponent(tag)}`, { kind: 'tag', log, timeoutMs: 90_000 });
  const out = new Map<number, { positive: number; negative: number }>();
  if (!res.ok) return out;
  try {
    const obj = JSON.parse(res.text) as Record<string, { appid: number; positive: number; negative: number }>;
    for (const v of Object.values(obj)) out.set(v.appid, { positive: v.positive, negative: v.negative });
  } catch {
    /* SteamSpy sometimes returns HTML; treat as empty */
  }
  return out;
}
