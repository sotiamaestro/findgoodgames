// Constants shared by the pipeline and the UI so both compute the same scores
// and apply the same thresholds.

/** value = 100 * wilson - PRICE_WEIGHT * priceUSD. Tuned against the top 30; see DECISIONS.md. */
export const PRICE_WEIGHT = 0.75;

/** Wilson score lower bound at 95% confidence. */
export const WILSON_Z = 1.96;

/** Pipeline inclusion bar (the UI defaults are stricter). */
export const MIN_REVIEWS = 100;
export const MIN_PCT = 70;

/** Hidden gem: 90%+ positive, 200-5,000 reviews, $15 or less. */
export const GEM = { minPct: 90, minReviews: 200, maxReviews: 5000, maxPriceCents: 1500 } as const;

/** "Just left Early Access" window in days. */
export const LEFT_EA_DAYS = 90;

/** UI defaults; an empty URL shows exactly this. */
export const DEFAULT_FILTERS = {
  maxPrice: 20, // USD, current price; 60 means "$60+" (no cap)
  party: 4, // 2..8, 8 means "8+"
  modes: [] as Array<'online' | 'local' | 'split' | 'lan'>,
  oneCopy: false,
  gfn: true,
  hideEa: true,
  minPct: 85,
  minReviews: 200,
  tags: [] as string[],
  onSale: false,
  hideMmo: true,
  confirmedPlayers: false,
  sort: 'value' as SortKey,
};

export type SortKey = 'value' | 'rated' | 'cheapest' | 'discount' | 'newest' | 'reviewed';

export const SORT_LABELS: Record<SortKey, string> = {
  value: 'Best value',
  rated: 'Highest rated',
  cheapest: 'Cheapest',
  discount: 'Biggest discount',
  newest: 'Newest',
  reviewed: 'Most reviewed',
};

/** Steam category ids (confirmed against GetStoreCategories in PROBE.md). */
export const CAT = {
  COOP: 9,
  ONLINE_COOP: 38,
  SPLIT_COOP: 39,
  LAN_COOP: 48,
  REMOTE_PLAY_TOGETHER: 44,
  MMO: 20,
  CROSS_PLATFORM: 27,
  SHARED_SPLIT_SCREEN: 24,
} as const;

/** Category names, so the pipeline can also match on text (appdetails fallback). */
export const CAT_NAMES: Record<number, string> = {
  9: 'Co-op',
  38: 'Online Co-op',
  39: 'Shared/Split Screen Co-op',
  48: 'LAN Co-op',
  44: 'Remote Play Together',
  20: 'MMO',
  27: 'Cross-Platform Multiplayer',
  24: 'Shared/Split Screen',
};

/** Content descriptor ids that exclude a game. */
export const ADULT_DESCRIPTORS = [3, 4] as const;

/** Early Access genre id in appdetails. */
export const EA_GENRE_ID = 70;

/** Steam user-tag ids used to build the candidate list (see PROBE.md). */
export const COOP_TAG_IDS = [1685, 3843, 3841, 4508, 10816, 4840, 7368] as const;

/** Number of tag names kept in the dataset for the tag filter. */
export const TAG_FILTER_COUNT = 40;

export function wilsonLower(pos: number, total: number, z = WILSON_Z): number {
  if (total <= 0) return 0;
  const p = pos / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = p + z2 / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return Math.max(0, (centre - spread) / denom);
}

export function valueScore(wilson: number, priceCents: number): number {
  return 100 * wilson - PRICE_WEIGHT * (priceCents / 100);
}

export function isHiddenGem(g: { rev: { pct: number; pos: number; neg: number }; price: { now: number } }): boolean {
  const n = g.rev.pos + g.rev.neg;
  return g.rev.pct >= GEM.minPct && n >= GEM.minReviews && n <= GEM.maxReviews && g.price.now <= GEM.maxPriceCents;
}

/** GitHub repo that hosts the data branch (games.json, gfn-steam.json). */
export const DATA_REPO = 'sotiamaestro/findgoodgames';
