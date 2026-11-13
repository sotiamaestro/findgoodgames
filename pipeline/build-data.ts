// Builds games.json, gfn-steam.json and cache.json.
//
//   tsx pipeline/build-data.ts [--full | --prices] [--limit N] [--data-dir DIR] [--fallback]
//
// --full    (default) rebuild everything: candidates, store data, review
//           totals, GeForce NOW, player counts, scores.
// --prices  daily refresh: re-pull price / Early Access / review summary for
//           the games already in games.json, plus the GeForce NOW list.
// --limit N development: stop collecting candidates after N store items.
// --data-dir where games.json / gfn-steam.json / cache.json live (default .data).
// --fallback also write public/data/games.fallback.json (the snapshot bundled with the site).

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Dataset, Game, Pick } from '../shared/types.ts';
import { CAT, LEFT_EA_DAYS, MIN_PCT, MIN_REVIEWS, TAG_FILTER_COUNT, valueScore, wilsonLower } from '../shared/config.ts';
import { RateLimitedError } from './lib/http.ts';
import {
  allCoopTagged,
  compactItem,
  coopFromCategories,
  getItems,
  getReviewTotals,
  getTagNames,
  getCategoryNames,
  getAppDetailsBlurb,
  hasAnyCoop,
  isAdult,
  steamSpyTag,
  PRICE_DATA_REQUEST,
  type RawStoreItem,
  type StoreRecord,
} from './lib/steam.ts';
import { fetchGfnSteamCatalog, gfnSupported, type GfnEntry } from './lib/gfn.ts';
import { lookupPlayers, type Players } from './lib/pcgw-fetch.ts';

// ---------------------------------------------------------------------------
// CLI

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const MODE: 'full' | 'prices' = flag('--prices') ? 'prices' : 'full';
const LIMIT = opt('--limit') ? Number(opt('--limit')) : 0;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(opt('--data-dir') ?? path.join(ROOT, '.data'));
const WRITE_FALLBACK = flag('--fallback');
const VERBOSE = flag('--verbose');
const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);

const log = (line: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
const vlog = VERBOSE ? log : () => undefined;

// ---------------------------------------------------------------------------
// Cache on the data branch

type Cache = {
  version: 2;
  /** Exact review totals; refetched when older than REVIEW_TTL_MS (so a crashed run resumes). */
  reviews: Record<string, { at: string; pos: number; neg: number; label: string }>;
  /** PCGamingWiki lookups, including misses (players null, page null); 30 days. */
  pcgw: Record<string, { at: string; page: string | null; players: Players | null }>;
  /** Early Access history per appid. */
  history: Record<string, { wasEa: boolean; leftEaAt: string | null; firstSeen: string; lastSeen: string }>;
  /** Last successful GeForce NOW pull, used when NVIDIA is down. */
  gfn: { at: string; steam: Record<string, string> } | null;
  /** Store records kept for games that fail to refetch (keeps cached data instead of dropping). */
  store: Record<string, { at: string; rec: StoreRecord }>;
  /** appdetails blurbs for games whose GetItems record has no short description; 30 days. */
  blurbs: Record<string, { at: string; blurb: string | null }>;
};

const REVIEW_TTL_MS = 20 * 3600_000;
const PCGW_TTL_MS = 30 * 86400_000;
const STORE_TTL_MS = 30 * 86400_000;

function emptyCache(): Cache {
  return { version: 2, reviews: {}, pcgw: {}, history: {}, gfn: null, store: {}, blurbs: {} };
}

async function loadCache(): Promise<Cache> {
  try {
    const raw = JSON.parse(await readFile(path.join(DATA_DIR, 'cache.json'), 'utf8')) as Partial<Cache> & { version?: number };
    if (raw.version !== 2) {
      log('cache: unknown version, starting fresh');
      return emptyCache();
    }
    return { ...emptyCache(), ...raw } as Cache;
  } catch {
    return emptyCache();
  }
}

let cacheDirty = 0;
async function saveCache(cache: Cache, force = false): Promise<void> {
  cacheDirty++;
  if (!force && cacheDirty % 50 !== 0) return;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path.join(DATA_DIR, 'cache.json'), JSON.stringify(cache));
  vlog('cache saved');
}

function fresh(at: string | undefined, ttl: number): boolean {
  return !!at && NOW.getTime() - Date.parse(at) < ttl;
}

// ---------------------------------------------------------------------------
// Picks

async function loadPicks(): Promise<Map<number, Pick>> {
  try {
    const raw = JSON.parse(await readFile(path.join(ROOT, 'data', 'picks.json'), 'utf8')) as Pick[];
    return new Map(raw.filter((p) => p && Number.isFinite(p.appid) && p.appid > 0).map((p) => [p.appid, p]));
  } catch {
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Stages

type Stage2 = StoreRecord & { coop: ReturnType<typeof coopFromCategories>; mmo: boolean };

async function stageCandidates(picks: Map<number, Pick>): Promise<Map<number, RawStoreItem>> {
  const items = new Map<number, RawStoreItem>();

  // Steam's own tag query (complete) and SteamSpy's tag lists run concurrently
  // because they are different hosts; each host stays serial.
  const spyIds = new Set<number>();
  const spyTask =
    MODE === 'full' && !LIMIT
      ? (async () => {
          for (const tag of ['Co-op', 'Online Co-Op', 'Local Co-Op']) {
            try {
              const m = await steamSpyTag(tag, vlog);
              let kept = 0;
              for (const [appid, c] of m) {
                if (c.positive + c.negative >= MIN_REVIEWS) {
                  spyIds.add(appid);
                  kept++;
                }
              }
              log(`steamspy tag "${tag}": ${m.size} games, ${kept} with ${MIN_REVIEWS}+ reviews`);
            } catch (err) {
              log(`steamspy tag "${tag}" failed (${err instanceof Error ? err.message : err}); continuing without it`);
            }
          }
        })()
      : Promise.resolve();

  const tagged = await allCoopTagged(vlog, LIMIT || undefined);
  for (const [id, it] of tagged) items.set(id, it);
  log(`steam tag query: ${tagged.size} games`);
  await spyTask;

  // Extra appids (SteamSpy-only and curated picks) need their own store data.
  const extras = [...new Set([...spyIds, ...picks.keys()])].filter((id) => !items.has(id));
  if (LIMIT) extras.splice(0, extras.length, ...extras.filter((id) => picks.has(id)));
  for (let i = 0; i < extras.length; i += 100) {
    const batch = extras.slice(i, i + 100);
    try {
      for (const it of await getItems(batch, undefined, vlog)) if (it.id) items.set(it.id, it);
    } catch (err) {
      log(`GetItems extras batch failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  log(`[1] candidates: ${items.size} (tag query ${tagged.size}, steamspy ${spyIds.size}, picks ${picks.size}, extra fetched ${extras.length})`);
  return items;
}

function stageStoreFilter(items: Map<number, RawStoreItem>, cache: Cache): Stage2[] {
  const out: Stage2[] = [];
  const drops = { notGame: 0, comingSoon: 0, noCoop: 0, adult: 0, fewReviews: 0, unpurchasable: 0, broken: 0 };
  let genericOnly = 0;
  let ea = 0;
  for (const it of items.values()) {
    const rec = compactItem(it);
    if (!rec) {
      drops.broken++;
      continue;
    }
    if (rec.type !== 0) {
      drops.notGame++;
      continue;
    }
    if (rec.comingSoon || !rec.released) {
      drops.comingSoon++;
      continue;
    }
    if (!rec.free && rec.priceNow == null) {
      // No purchase option and not free to play: delisted or only sold inside a bundle.
      drops.unpurchasable++;
      continue;
    }
    if (!hasAnyCoop(rec.cats)) {
      drops.noCoop++;
      continue;
    }
    if (isAdult(rec.descriptors)) {
      drops.adult++;
      continue;
    }
    if (rec.reviewCount < MIN_REVIEWS) {
      drops.fewReviews++;
      continue;
    }
    const coop = coopFromCategories(rec.cats, rec.tagids);
    if (!rec.cats.includes(CAT.ONLINE_COOP) && !rec.cats.includes(CAT.SPLIT_COOP) && !rec.cats.includes(CAT.LAN_COOP)) genericOnly++;
    if (rec.ea) ea++;
    cache.store[rec.id] = { at: NOW.toISOString(), rec };
    out.push({ ...rec, coop, mmo: rec.cats.includes(CAT.MMO) });
  }
  log(
    `[2] store filter: ${out.length} kept (dropped: not a game ${drops.notGame}, unreleased ${drops.comingSoon}, no co-op category ${drops.noCoop}, adult ${drops.adult}, under ${MIN_REVIEWS} reviews ${drops.fewReviews}, not purchasable ${drops.unpurchasable}, broken ${drops.broken}); flagged Early Access ${ea}; generic "Co-op" category only ${genericOnly}`,
  );
  return out;
}

type Stage3 = Stage2 & { pos: number; neg: number; label: string; exact: boolean };

async function stageReviews(games: Stage2[], cache: Cache): Promise<Stage3[]> {
  const out: Stage3[] = [];
  // Games that cannot reach the inclusion bar even on the store summary are
  // not worth a request (percent_positive is an integer; 69 means < 69.5%).
  const need = games.filter((g) => g.reviewPct >= MIN_PCT - 1);
  const skipped = games.length - need.length;
  let fetched = 0;
  let cached = 0;
  let failed = 0;
  let rateLimited = false;
  const started = Date.now();
  for (let i = 0; i < need.length; i++) {
    const g = need[i]!;
    const c = cache.reviews[g.id];
    let totals: { pos: number; neg: number; label: string } | null = null;
    let exact = true;
    if (c && fresh(c.at, REVIEW_TTL_MS)) {
      totals = c;
      cached++;
    } else if (!rateLimited) {
      try {
        totals = await getReviewTotals(g.id, vlog);
        if (totals) {
          cache.reviews[g.id] = { at: NOW.toISOString(), ...totals };
          fetched++;
          await saveCache(cache);
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
        if (err instanceof RateLimitedError) {
          log(`reviews: rate limited for good, using store summaries for the remaining ${need.length - i} games`);
          rateLimited = true;
        }
      }
    }
    if (!totals) {
      // Fall back to the store summary (count + integer percent), or a stale cache entry.
      if (c) {
        totals = c;
      } else {
        const pos = Math.round((g.reviewCount * g.reviewPct) / 100);
        totals = { pos, neg: g.reviewCount - pos, label: g.reviewLabel };
      }
      exact = false;
    }
    out.push({ ...g, ...totals, exact });
    if ((i + 1) % 200 === 0) {
      const rate = (i + 1) / ((Date.now() - started) / 1000);
      log(`reviews: ${i + 1}/${need.length} (${fetched} fetched, ${cached} cached, ${failed} failed, ${rate.toFixed(1)}/s, ~${Math.round((need.length - i - 1) / Math.max(rate, 0.1) / 60)} min left)`);
    }
  }
  await saveCache(cache, true);
  log(`[3] review totals: ${out.length} games (${fetched} fetched, ${cached} from cache, ${failed} failed, ${skipped} skipped as under ${MIN_PCT}% on the store summary)`);
  return out;
}

function stageInclusion(games: Stage3[]): Stage3[] {
  const out = games.filter((g) => g.pos + g.neg >= MIN_REVIEWS && (100 * g.pos) / (g.pos + g.neg) >= MIN_PCT);
  log(`[4] inclusion (${MIN_REVIEWS}+ reviews, ${MIN_PCT}%+): ${out.length}`);
  return out;
}

/** Older store pages have no short_description in GetItems; fetch it from appdetails once a month. */
async function stageBlurbs<T extends { id: number; blurb: string }>(games: T[], cache: Cache): Promise<void> {
  const need = games.filter((g) => !g.blurb);
  let fetched = 0;
  for (const g of need) {
    const c = cache.blurbs[g.id];
    if (c && fresh(c.at, STORE_TTL_MS)) {
      if (c.blurb) g.blurb = c.blurb;
      continue;
    }
    try {
      const blurb = await getAppDetailsBlurb(g.id, vlog);
      cache.blurbs[g.id] = { at: NOW.toISOString(), blurb };
      if (blurb) g.blurb = blurb;
      fetched++;
      await saveCache(cache);
    } catch (err) {
      if (err instanceof RateLimitedError) {
        log(`blurbs: store rate limit exhausted; ${need.length - fetched} games keep an empty blurb`);
        break;
      }
    }
  }
  await saveCache(cache, true);
  log(`blurbs: ${need.length} games had no short description in GetItems; ${fetched} fetched from appdetails, ${games.filter((g) => !g.blurb).length} still empty`);
}

async function stageGfn(cache: Cache): Promise<Map<number, GfnEntry>> {
  try {
    const m = await fetchGfnSteamCatalog(vlog);
    cache.gfn = { at: NOW.toISOString(), steam: Object.fromEntries([...m].map(([id, e]) => [id, e.status])) };
    await saveCache(cache, true);
    log(`[5] GeForce NOW: ${m.size} Steam apps in NVIDIA's catalog`);
    return m;
  } catch (err) {
    if (cache.gfn) {
      log(`[5] GeForce NOW: live pull failed (${err instanceof Error ? err.message : err}); using cached list from ${cache.gfn.at}`);
      return new Map(Object.entries(cache.gfn.steam).map(([id, status]) => [Number(id), { status, title: '' }]));
    }
    throw err;
  }
}

async function stagePlayers(games: Array<{ id: number; name: string }>, cache: Cache): Promise<Map<number, Players | null>> {
  const out = new Map<number, Players | null>();
  const need = new Map<number, string>();
  for (const g of games) {
    const c = cache.pcgw[g.id];
    if (c && fresh(c.at, PCGW_TTL_MS)) out.set(g.id, c.players);
    else need.set(g.id, g.name);
  }
  log(`players: ${out.size} from cache, ${need.size} to look up on PCGamingWiki`);
  if (need.size) {
    let lastLogged = 0;
    const found = await lookupPlayers(need, {
      log: vlog,
      onProgress: (done, total) => {
        if (done - lastLogged >= 100 || done === total) {
          lastLogged = done;
          log(`pcgw: ${done}/${total} requests`);
        }
      },
    });
    for (const [id] of need) {
      const r = found.get(id);
      cache.pcgw[id] = { at: NOW.toISOString(), page: r?.page ?? null, players: r?.players ?? null };
      out.set(id, r?.players ?? null);
    }
    await saveCache(cache, true);
  }
  const withAny = [...out.values()].filter((p) => p && (p.online || p.local || p.lan)).length;
  log(`[6] player counts: ${withAny}/${games.length} games have at least one count`);
  return out;
}

function updateHistory(cache: Cache, id: number, ea: boolean, steamLeftEaAt: string | null): string | null {
  const h = cache.history[id] ?? { wasEa: false, leftEaAt: null, firstSeen: TODAY, lastSeen: TODAY };
  h.lastSeen = TODAY;
  if (ea) {
    h.wasEa = true;
    h.leftEaAt = null;
  } else if (steamLeftEaAt) {
    h.wasEa = true;
    h.leftEaAt = steamLeftEaAt;
  } else if (h.wasEa && !h.leftEaAt) {
    h.leftEaAt = TODAY;
  }
  cache.history[id] = h;
  return h.leftEaAt;
}

/** Tags that only restate the co-op mode or release state; they are not useful filters. */
const EXCLUDED_TAGS = new Set([1685, 3843, 3841, 4508, 10816, 4840, 7368, 3859, 4182, 493, 113, 128, 17770, 1773, 3834, 1702]);
// 1685 Co-op, 3843 Online Co-Op, 3841 Local Co-Op, 4508 Co-op Campaign, 10816 Split Screen,
// 4840 4 Player Local, 7368 Local Multiplayer, 3859 Multiplayer, 4182 Singleplayer,
// 493 Early Access, 113 Free to Play, 128 Massively Multiplayer, 17770 Asynchronous Multiplayer,
// 1773 Action-Adventure? (kept generic), 3834 Exploration?, 1702 Crafting? -> see tag list; only ids that exist are affected.

function buildDataset(
  games: Array<Stage3 & { players: Players | null; gfn: GfnEntry | undefined; leftEaAt: string | null }>,
  tagNamesById: Map<number, string>,
  picks: Map<number, Pick>,
): Dataset {
  // Tag vocabulary: every tag that appears in a game's top 8 (after exclusions).
  const TAGS_PER_GAME = 8;
  const freq = new Map<number, number>();
  const perGame = new Map<number, number[]>();
  for (const g of games) {
    const ids = g.tagids.filter((t) => !EXCLUDED_TAGS.has(t) && tagNamesById.has(t)).slice(0, TAGS_PER_GAME);
    perGame.set(g.id, ids);
    for (const t of ids) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  const vocab = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const pickOrder = new Map([...picks.keys()].map((id, i) => [id, i + 1]));
  const index = new Map(vocab.map((t, i) => [t, i]));
  const tagNames = vocab.map((t) => tagNamesById.get(t)!);

  const out: Game[] = games.map((g) => {
    const total = g.pos + g.neg;
    const wilson = wilsonLower(g.pos, total);
    const now = g.priceNow ?? 0;
    const base = g.priceBase ?? now;
    const pct = g.exact && g.reviewPct ? g.reviewPct : Math.floor((100 * g.pos) / Math.max(total, 1));
    return {
      id: g.id,
      name: g.name,
      cap: g.cap,
      img: g.img ?? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${g.id}/header.jpg`,
      blurb: g.blurb,
      released: g.released,
      price: { now, base, off: g.off || (base > now ? Math.round((100 * (base - now)) / base) : 0), free: g.free },
      rev: { pos: g.pos, neg: g.neg, pct, wilson: Math.round(wilson * 10000) / 10000, label: g.label || g.reviewLabel },
      coop: g.coop,
      players: g.players && (g.players.online || g.players.local) ? { online: g.players.online, local: g.players.local } : null,
      gfn: { ok: gfnSupported(g.gfn), optimized: null },
      ea: g.ea,
      leftEaAt: g.leftEaAt,
      tags: (perGame.get(g.id) ?? []).map((t) => index.get(t)!),
      value: Math.round(valueScore(wilson, now) * 100) / 100,
      pick: picks.get(g.id)?.line || null,
      best: picks.get(g.id)?.best || null,
      pickRank: pickOrder.get(g.id) ?? null,
      mmo: g.mmo,
    };
  });
  out.sort((a, b) => b.value - a.value);
  return { generatedAt: NOW.toISOString(), tagNames, games: out };
}

async function writeOutputs(dataset: Dataset, gfnIds: number[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const json = JSON.stringify(dataset);
  await writeFile(path.join(DATA_DIR, 'games.json'), json);
  await writeFile(path.join(DATA_DIR, 'gfn-steam.json'), JSON.stringify(gfnIds));
  const gz = gzipSync(json).length;
  log(`[7] output: games.json ${(json.length / 1e6).toFixed(2)} MB raw, ${(gz / 1e3).toFixed(0)} KB gzipped, ${dataset.games.length} games, ${dataset.tagNames.length} tag names; gfn-steam.json ${gfnIds.length} appids`);
  if (json.length > 2_000_000) log(`!! games.json is over 2 MB; raise MIN_REVIEWS/MIN_PCT in shared/config.ts and record it in DECISIONS.md`);
  if (WRITE_FALLBACK) {
    const fb = path.join(ROOT, 'public', 'data');
    await mkdir(fb, { recursive: true });
    await writeFile(path.join(fb, 'games.fallback.json'), json);
    log(`wrote public/data/games.fallback.json`);
  }
}

// ---------------------------------------------------------------------------

async function runFull(cache: Cache): Promise<void> {
  const picks = await loadPicks();
  const [tagNamesById, catNames] = await Promise.all([getTagNames(vlog), getCategoryNames(vlog)]);
  // Sanity check the category ids we rely on against their live names.
  for (const [id, expected] of Object.entries({ 9: 'Co-op', 38: 'Online Co-op', 39: 'Shared/Split Screen Co-op', 48: 'LAN Co-op', 44: 'Remote Play Together', 20: 'MMO' })) {
    const live = catNames.get(Number(id));
    if (live !== expected) log(`!! category ${id} is "${live}" on Steam, expected "${expected}"`);
  }
  const unknownCoop = [...catNames].filter(([id, name]) => /co-?op/i.test(name) && ![9, 38, 39, 48].includes(id));
  if (unknownCoop.length) log(`!! unknown co-op categories: ${unknownCoop.map(([id, n]) => `${id} ${n}`).join(', ')}`);

  const gfnTask = stageGfn(cache); // different host, runs alongside the Steam stages
  const candidates = await stageCandidates(picks);
  const stage2 = stageStoreFilter(candidates, cache);
  const stage3 = await stageReviews(stage2, cache);
  const stage4 = stageInclusion(stage3);
  await stageBlurbs(stage4, cache);
  const gfn = await gfnTask;
  const players = await stagePlayers(stage4, cache);

  const enriched = stage4.map((g) => ({
    ...g,
    players: players.get(g.id) ?? null,
    gfn: gfn.get(g.id),
    leftEaAt: updateHistory(cache, g.id, g.ea, g.leftEaAt),
  }));
  const dataset = buildDataset(enriched, tagNamesById, picks);
  const gfnIds = [...gfn.keys()].filter((id) => gfnSupported(gfn.get(id))).sort((a, b) => a - b);
  await writeOutputs(dataset, gfnIds);
  await saveCache(cache, true);
  printTop(dataset);
}

async function runPrices(cache: Cache): Promise<void> {
  const prev = JSON.parse(await readFile(path.join(DATA_DIR, 'games.json'), 'utf8')) as Dataset;
  log(`prices: refreshing ${prev.games.length} games from ${prev.generatedAt}`);
  const ids = prev.games.map((g) => g.id);
  const updates = new Map<number, RawStoreItem>();
  for (let i = 0; i < ids.length; i += 100) {
    try {
      for (const it of await getItems(ids.slice(i, i + 100), PRICE_DATA_REQUEST, vlog)) if (it.id) updates.set(it.id, it);
    } catch (err) {
      log(`GetItems price batch failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  const gfn = await stageGfn(cache);
  let changed = 0;
  const gone = new Set<number>();
  for (const g of prev.games) {
    const it = updates.get(g.id);
    if (it) {
      const rec = compactItem(it);
      if (rec && !rec.free && rec.priceNow == null) gone.add(g.id);
      if (rec && !rec.comingSoon) {
        const now = rec.priceNow ?? 0;
        const base = rec.priceBase ?? now;
        if (now !== g.price.now || base !== g.price.base) changed++;
        g.price = { now, base, off: rec.off || (base > now ? Math.round((100 * (base - now)) / base) : 0), free: rec.free };
        g.ea = rec.ea;
        g.leftEaAt = updateHistory(cache, g.id, rec.ea, rec.leftEaAt);
        if (rec.reviewLabel) g.rev.label = rec.reviewLabel;
        g.value = Math.round(valueScore(g.rev.wilson, now) * 100) / 100;
      }
    }
    g.gfn = { ok: gfnSupported(gfn.get(g.id)), optimized: null };
  }
  if (gone.size) {
    prev.games = prev.games.filter((g) => !gone.has(g.id));
    log(`prices: dropped ${gone.size} games that are no longer purchasable`);
  }
  prev.games.sort((a, b) => b.value - a.value);
  prev.generatedAt = NOW.toISOString();
  log(`prices: ${changed} games changed price`);
  const gfnIds = [...gfn.keys()].filter((id) => gfnSupported(gfn.get(id))).sort((a, b) => a - b);
  await writeOutputs(prev, gfnIds);
  await saveCache(cache, true);
}

function printTop(dataset: Dataset): void {
  const def = dataset.games.filter((g) => !g.ea && g.gfn.ok && g.price.now <= 2000 && g.rev.pct >= 85 && g.rev.pos + g.rev.neg >= 200 && !g.mmo);
  log(`default view: ${def.length} games pass the UI defaults (released, GeForce NOW, <= $20, 85%+, 200+ reviews, no MMO)`);
  console.log('\n  top 30 by value (default filters):');
  for (const g of def.slice(0, 30)) {
    console.log(`  ${String(g.value.toFixed(1)).padStart(6)}  ${g.rev.pct}%  ${String(g.rev.pos + g.rev.neg).padStart(7)} rev  $${(g.price.now / 100).toFixed(2).padStart(6)}  ${g.players?.online ?? '?'}p  ${g.name}`);
  }
  console.log('');
}

async function main(): Promise<void> {
  const t0 = Date.now();
  await mkdir(DATA_DIR, { recursive: true });
  const cache = await loadCache();
  log(`mode=${MODE}${LIMIT ? ` limit=${LIMIT}` : ''} data-dir=${DATA_DIR} cache: ${Object.keys(cache.reviews).length} reviews, ${Object.keys(cache.pcgw).length} pcgw, ${Object.keys(cache.history).length} history`);
  if (MODE === 'prices') {
    try {
      await stat(path.join(DATA_DIR, 'games.json'));
    } catch {
      log('prices: no games.json yet, running a full build instead');
      await runFull(cache);
      return;
    }
    await runPrices(cache);
  } else {
    await runFull(cache);
  }
  log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
