// Phase 0: probe every external data source once, save the raw responses to
// pipeline/samples/, and write pipeline/PROBE.md with what actually works.
//
//   npm run probe            (optionally STEAM_API_KEY=... npm run probe)
//
// Every request goes through the per-host serial queue in lib/http.ts, so the
// probe respects the same rate limits as the pipeline.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rlFetch, rlJson, USER_AGENT } from './lib/http.ts';
import { parseMultiplayer, parseSteamAppIds } from './lib/pcgw.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.join(HERE, 'samples');
const STEAM_KEY = process.env.STEAM_API_KEY ?? '';

type Section = { title: string; lines: string[] };
const sections: Section[] = [];
function section(title: string): (line: string) => void {
  const s: Section = { title, lines: [] };
  sections.push(s);
  return (line: string) => s.lines.push(line);
}

const log = (line: string) => console.log(`  ${line}`);

async function save(name: string, text: string): Promise<void> {
  await writeFile(path.join(SAMPLES, name), text);
}

function json<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function hist(values: unknown[]): string {
  const m = new Map<string, number>();
  for (const v of values) m.set(String(v), (m.get(String(v)) ?? 0) + 1);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}: ${n}`)
    .join(', ');
}

async function safely(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n== ${name}`);
  try {
    await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  !! ${msg}`);
    const add = section(`${name} (FAILED)`);
    add(`The probe threw: \`${msg}\``);
  }
}

// ---------------------------------------------------------------------------
// Test cases: Portal 2 plus a few well known co-op games covering the states
// we care about (Early Access, free to play, left Early Access, on sale).
// ---------------------------------------------------------------------------
const TEST_APPIDS = [620, 548430, 1966720, 2767030, 892970, 3527290, 1942280, 1446780];
const TEST_NAMES: Record<number, string> = {
  620: 'Portal 2',
  548430: 'Deep Rock Galactic',
  1966720: 'Lethal Company (Early Access)',
  2767030: 'Marvel Rivals (free)',
  892970: 'Valheim (left Early Access 2026)',
  3527290: 'PEAK (2025 release, hashed capsule path)',
  1942280: 'Brotato (on sale while probing)',
  1446780: 'Monster Hunter Rise',
};

const STEAM_CONTEXT = { language: 'english', country_code: 'US', steam_realm: 1 };
const DATA_REQUEST = {
  include_assets: true,
  include_release: true,
  include_platforms: true,
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

const COOP_TAGIDS = [1685, 3843, 3841, 4508, 10816, 4840, 7368];
const GFN_ENDPOINT = 'https://api-prod.nvidia.com/services/gfngames/v1/gameList';
const GFN_VPC = process.env.GFN_VPC_ID ?? 'NP-SJC6-04';

// ---------------------------------------------------------------------------
async function probeGfnStatic(): Promise<void> {
  const add = section('GeForce NOW: static public list (the URL from the brief)');
  const url = 'https://static.nvidiagrid.net/supported-public-game-list/locales/gfnpc-en-US.json';
  const res = await rlFetch(url, { log });
  await save('gfn-static-gfnpc-en-US.json', res.text);
  const list = json<Array<Record<string, unknown>>>(res.text) ?? [];
  const steam = list.filter((e) => e.store === 'Steam' && typeof e.steamUrl === 'string');
  const hasPalworld = steam.some((e) => /\/1623730(\/|$)/.test(String(e.steamUrl)));
  const hasPeak = steam.some((e) => /\/3527290(\/|$)/.test(String(e.steamUrl)));
  add(`- URL: \`${url}\``);
  add(`- HTTP ${res.status}, ${res.text.length.toLocaleString()} bytes, ${res.ms} ms, no key needed.`);
  add(`- Header \`last-modified\`: **${res.headers.get('last-modified')}**. The file still answers, but it has not been regenerated since then.`);
  add(`- ${list.length} entries, stores: ${hist(list.map((e) => e.store || '(empty)'))}.`);
  add(`- Fields: ${Object.keys(list[0] ?? {}).join(', ')}. Steam appid is the last path segment of \`steamUrl\`; \`isFullyOptimized\` is the "optimized" flag; \`status\` is ${hist(list.map((e) => e.status))}.`);
  add(`- Freshness check: Palworld (1623730, on GeForce NOW since Jan 2024) present: **${hasPalworld}**. PEAK (3527290, 2025) present: **${hasPeak}**.`);
  add(`- Verdict: **stale, do not use as the source of truth.** Kept only as a documented dead end.`);

  const url2 = 'https://static.nvidiagrid.net/supported-public-game-list/gfnpc.json';
  const res2 = await rlFetch(url2, { log });
  await save('gfn-static-gfnpc.json', res2.text);
  add(`- Sibling \`${url2}\`: HTTP ${res2.status}, body is \`${res2.text.slice(0, 20)}\` (${res2.text.length} bytes). Dead.`);
}

type GfnVariant = { id: string; appStore: string; osType: string; storeId: string | null; gfn: { status: string; releaseDate: string | null } };
type GfnApp = { id: string; title: string; sortName: string; variants: GfnVariant[] };
type GfnPage = { data?: { apps?: { numberReturned: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; items: GfnApp[] } }; errors?: Array<{ message: string }> };

async function gfnQuery(body: string): Promise<{ page: GfnPage | null; text: string; status: number; ms: number }> {
  const res = await rlFetch(GFN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    log,
  });
  return { page: json<GfnPage>(res.text), text: res.text, status: res.status, ms: res.ms };
}

async function probeGfnGraphql(): Promise<void> {
  const add = section("GeForce NOW: NVIDIA's current catalog API (what the GFN website uses)");
  const fields = `{id title sortName variants{id appStore osType storeId gfn{status releaseDate}}}`;
  const q = (after: string | null) =>
    `{apps(country:"US",language:"en_US",vpcId:"${GFN_VPC}",first:750${after ? `,after:"${after}"` : ''}){numberReturned pageInfo{hasNextPage endCursor}items${fields}}}`;

  const first = await gfnQuery(q(null));
  await save('gfn-graphql-page1.json', first.text);
  const apps = first.page?.data?.apps;
  add(`- Endpoint: \`POST ${GFN_ENDPOINT}\` with the raw GraphQL document as the body (no \`{"query": ...}\` envelope), no key, no cookies. HTTP/1.1 works; HTTP/2 streams were reset by the edge.`);
  add(`- Query used: \`${q(null)}\``);
  add(`- Page 1: HTTP ${first.status}, ${first.text.length.toLocaleString()} bytes, ${first.ms} ms, numberReturned=${apps?.numberReturned}, hasNextPage=${apps?.pageInfo.hasNextPage}, endCursor=${apps?.pageInfo.endCursor} (base64 of the offset).`);
  if (!apps) {
    add(`- !! No data. Errors: ${JSON.stringify(first.page?.errors ?? first.text.slice(0, 300))}`);
    return;
  }
  const variants1 = apps.items.flatMap((a) => a.variants);
  add(`- Variant \`appStore\` values on page 1: ${hist(variants1.map((v) => v.appStore))}.`);
  add(`- Variant \`gfn.status\` values on page 1 (with vpcId \`${GFN_VPC}\`): ${hist(variants1.map((v) => v.gfn?.status))}. Without a vpcId every status comes back \`UNKNOWN\`; with an unknown vpcId the list collapses to ~10 items in SERVER_MAINTENANCE. Valid vpcIds are the region codes on https://status.geforcenow.com/ (US examples: NP-SJC6-04, NP-DAL-04, NP-ASH-04, all returned identical pages).`);
  add(`- \`storeId\` for appStore=STEAM is the Steam appid as a string. There is no \`steamUrl\` field here. Field names that do NOT exist (validation errors): isFullyOptimized, isOptimized, optimized, steamUrl, playType, membershipTier, gfnCertified, rtx, dlss. \`gfn.features\` exists but needs subfields (probed below).`);

  // Walk the whole catalog so we know its size and that pagination is sound.
  const steamIds = new Set<number>();
  const statusAll: string[] = [];
  let page = first.page;
  let pages = 1;
  let cursor = apps.pageInfo.endCursor;
  let more = apps.pageInfo.hasNextPage;
  let items = apps.items.length;
  const collect = (p: GfnPage) => {
    for (const a of p.data?.apps?.items ?? []) {
      for (const v of a.variants) {
        if (v.appStore === 'STEAM' && v.storeId && /^\d+$/.test(v.storeId)) {
          steamIds.add(Number(v.storeId));
          statusAll.push(v.gfn?.status ?? 'null');
        }
      }
    }
  };
  collect(first.page!);
  while (more && cursor && pages < 40) {
    const next = await gfnQuery(q(cursor));
    page = next.page;
    const a = page?.data?.apps;
    if (!a) break;
    pages++;
    items += a.items.length;
    collect(page!);
    more = a.pageInfo.hasNextPage;
    cursor = a.pageInfo.endCursor;
  }
  const want = [620, 548430, 1623730, 3527290, 1966720];
  add(`- Full walk: ${pages} pages, ${items.toLocaleString()} apps, **${steamIds.size.toLocaleString()} distinct Steam appids** (the stale static file had 1,144). Steam variant status overall: ${hist(statusAll)}.`);
  add(`- Spot checks present: ${want.map((id) => `${id}=${steamIds.has(id)}`).join(', ')}.`);
  add(`- Decision: a game counts as "on GeForce NOW" when it has a STEAM variant whose \`gfn.status\` is not UNKNOWN/null (AVAILABLE, PATCHING and SERVER_MAINTENANCE are all "supported, maybe briefly offline"). \`optimized\` is stored as null because the current API exposes no such flag.`);

  // Discover the features subfields (cheap: validation errors name invalid fields).
  const disc = await gfnQuery(`{apps(country:"US",language:"en_US",vpcId:"${GFN_VPC}",first:3){items{id title variants{id gfn{status features{name id type tier feature value supported}}}}}}`);
  await save('gfn-graphql-features-discovery.json', disc.text);
  const errs = disc.page?.errors?.map((e) => e.message) ?? [];
  add(`- \`gfn.features\` discovery: ${errs.length ? `invalid subfields: ${errs.map((e) => e.match(/"([^"]+)"/)?.[1]).filter(Boolean).join(', ')}` : 'all guessed subfields valid'}; sample: \`${JSON.stringify(disc.page?.data?.apps?.items?.[0]?.variants?.[0]?.gfn ?? null).slice(0, 300)}\``);
}

// ---------------------------------------------------------------------------
async function probeSteamSpy(): Promise<void> {
  const add = section('SteamSpy: co-op tag lists and appdetails');
  const url = 'https://steamspy.com/api.php?request=tag&tag=Co-op';
  const res = await rlFetch(url, { kind: 'tag', log });
  await save('steamspy-tag-coop.json', res.text);
  const obj = json<Record<string, Record<string, unknown>>>(res.text) ?? {};
  const entries = Object.values(obj);
  const p2 = obj['620'];
  add(`- \`${url}\`: HTTP ${res.status}, ${res.text.length.toLocaleString()} bytes, ${res.ms} ms, no key.`);
  add(`- Shape: object keyed by appid. Fields: ${Object.keys(entries[0] ?? {}).join(', ')}. Prices are strings in cents (\`price\`, \`initialprice\`, \`discount\`).`);
  add(`- ${entries.length} games for tag Co-op. Earlier manual runs: Online Co-Op 508, Local Co-Op 193, union 895. The tag endpoint only returns SteamSpy's top slice, so it is a partial candidate list (compare: Steam's own query for the Co-op tag returns about 10,000 games).`);
  add(`- Portal 2 sample: positive=${p2?.positive}, negative=${p2?.negative}, price=${p2?.price}. Review counts are close to Steam's but not equal (estimates).`);
  add(`- Rate limit: documented 1 request/second, and 1 per 60 seconds for \`tag\` and \`all\` requests. Honoured via the \`steamspy.com#tag\` queue kind.`);

  const res2 = await rlFetch('https://steamspy.com/api.php?request=appdetails&appid=620', { log });
  await save('steamspy-appdetails-620.json', res2.text);
  const d = json<{ tags?: Record<string, number> }>(res2.text);
  add(`- \`request=appdetails&appid=620\`: HTTP ${res2.status}; \`tags\` is an object of tag name -> votes (${Object.keys(d?.tags ?? {}).slice(0, 5).join(', ')} ...). Not needed because Steam's GetTagList maps tag ids to names.`);
}

// ---------------------------------------------------------------------------
type StoreItem = Record<string, any>;

async function getItems(ids: number[], dataRequest: Record<string, unknown>, key = ''): Promise<{ items: StoreItem[]; text: string; status: number; ms: number; eresult: string | null }> {
  const input = { ids: ids.map((appid) => ({ appid })), context: STEAM_CONTEXT, data_request: dataRequest };
  const url = `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?${key ? `key=${encodeURIComponent(key)}&` : ''}input_json=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await rlFetch(url, { log });
  const data = json<{ response?: { store_items?: StoreItem[] } }>(res.text);
  return { items: data?.response?.store_items ?? [], text: res.text, status: res.status, ms: res.ms, eresult: res.headers.get('x-eresult') };
}

async function probeGetItems(): Promise<void> {
  const add = section('Steam IStoreBrowseService/GetItems (batched store data)');
  const r = await getItems(TEST_APPIDS, DATA_REQUEST);
  await save('steam-getitems-testset.json', r.text);
  add(`- \`GET https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=...\` **without a key**: HTTP ${r.status}, x-eresult=${r.eresult}, ${r.items.length}/${TEST_APPIDS.length} items, ${r.text.length.toLocaleString()} bytes, ${r.ms} ms.`);
  if (STEAM_KEY) {
    const rk = await getItems([620], { include_release: true }, STEAM_KEY);
    add(`- With STEAM_API_KEY: HTTP ${rk.status}, x-eresult=${rk.eresult}. A key is not required; it is only passed through when present.`);
  } else {
    add(`- STEAM_API_KEY was not set for this probe. Not needed: the keyless call succeeded.`);
  }
  add(`- Batch size: 100 appids in one call confirmed (64 KB, 0.3 s). Probably more, but 100 keeps responses small.`);
  add(`- Confirmed field paths (per store_item):`);
  for (const it of r.items) {
    const rel = it.release ?? {};
    const bpo = it.best_purchase_option ?? {};
    add(
      `  - ${it.id} ${it.name} (${TEST_NAMES[it.id] ?? ''}): type=${it.type}, is_free=${it.is_free ?? 'absent'}, is_early_access=${it.is_early_access ?? 'absent'}, release.is_early_access=${rel.is_early_access ?? 'absent'}, release.steam_release_date=${rel.steam_release_date}, release.release_from_early_access_date=${rel.release_from_early_access_date ?? 'absent'}, release.is_coming_soon=${rel.is_coming_soon ?? 'absent'}, best_purchase_option.final_price_in_cents=${bpo.final_price_in_cents ?? 'absent'}, original_price_in_cents=${bpo.original_price_in_cents ?? 'absent'}, discount_pct=${bpo.discount_pct ?? 'absent'}, reviews.summary_filtered={count ${it.reviews?.summary_filtered?.review_count}, pct ${it.reviews?.summary_filtered?.percent_positive}, label "${it.reviews?.summary_filtered?.review_score_label}"}, categories.supported_player_categoryids=[${it.categories?.supported_player_categoryids ?? ''}], feature_categoryids has 44 (Remote Play Together)=${(it.categories?.feature_categoryids ?? []).includes(44)}, content_descriptorids=[${it.content_descriptorids ?? ''}], tagids=${(it.tagids ?? []).length}, assets.library_capsule=${it.assets?.library_capsule ?? 'absent'}, assets.header=${it.assets?.header ?? 'absent'}`,
    );
  }
  add(`- Price: \`best_purchase_option.final_price_in_cents\` (string, USD cents for country_code US), \`original_price_in_cents\` + \`discount_pct\` only present while discounted; free games have \`is_free: true\` and no purchase option. Both \`is_early_access\` (top level) and \`release.is_early_access\` are present only when true.`);
  add(`- Reviews: \`reviews.summary_filtered\` is the store headline (count, integer percent, label). It does not split positive/negative, so exact counts come from GetAppReviews below.`);
  add(`- Art: build URLs as \`https://shared.akamai.steamstatic.com/store_item_assets/\` + \`assets.asset_url_format\` with \`\${FILENAME}\` replaced by \`assets.library_capsule\` (portrait) or \`assets.header\` (landscape). Newer uploads use a hashed sub-path (e.g. \`3dee.../library_capsule.jpg\`) and the plain \`library_600x900.jpg\` path 404s for some of them (PEAK), so always use the asset field, never a guessed path.`);
  add(`- Short description: \`basic_info.short_description\`. Tags: \`tagids\` (ordered by weight) plus \`tags[{tagid,weight}]\`.`);
}

async function probeStoreQuery(): Promise<void> {
  const add = section('Steam IStoreQueryService/Query (complete candidate list + store data in one call)');
  const mk = (start: number, count: number, tagids: number[][], dr: Record<string, unknown>) => ({
    query: { start, count, sort: 1, filters: { type_filters: { include_games: true }, tagids_must_match: tagids.map((t) => ({ tagids: t })) } },
    context: STEAM_CONTEXT,
    data_request: dr,
  });
  const call = async (input: unknown) => {
    const url = `https://api.steampowered.com/IStoreQueryService/Query/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`;
    const res = await rlFetch(url, { log });
    return { res, data: json<{ response?: { metadata?: { total_matching_records: number; start: number; count: number }; ids?: Array<{ appid: number }>; store_items?: StoreItem[] } }>(res.text) };
  };
  const page = await call(mk(0, 100, [COOP_TAGIDS], DATA_REQUEST));
  await save('steam-storequery-cooptags-page0.json', page.res.text);
  const items = page.data?.response?.store_items ?? [];
  const meta = page.data?.response?.metadata;
  add(`- \`GET https://api.steampowered.com/IStoreQueryService/Query/v1/?input_json=...\` without a key: HTTP ${page.res.status}, ${page.res.text.length.toLocaleString()} bytes, ${page.res.ms} ms.`);
  add(`- Filter \`tagids_must_match: [{tagids: [${COOP_TAGIDS.join(', ')}]}]\` (ids inside one entry are OR-ed; separate entries are AND-ed, verified: [1685]=10,056, [1685,3843]=13,322, [[1685],[3843]]=5,422 at probe time).`);
  add(`- total_matching_records=**${meta?.total_matching_records?.toLocaleString()}** for the co-op tag union (Co-op, Online Co-Op, Local Co-Op, Co-op Campaign, Split Screen, 4 Player Local, Local Multiplayer). \`count\` up to 500 per page is honoured; \`start\` works past 10,000; sort=1 is name ascending (stable enough for paging).`);
  add(`- Each page returns the same StoreItem objects as GetItems when \`data_request\` is passed, so this one endpoint gives the candidate list **and** the store data: about ${Math.ceil((meta?.total_matching_records ?? 0) / 500)} requests instead of thousands of appdetails calls.`);
  const withCap = items.filter((i) => i.assets?.library_capsule).length;
  const withHeader = items.filter((i) => i.assets?.header).length;
  add(`- Portrait art share on this page: ${withCap}/${items.length} have \`assets.library_capsule\`, ${withHeader}/${items.length} have \`assets.header\`. is_coming_soon: ${items.filter((i) => i.is_coming_soon).length}, is_early_access: ${items.filter((i) => i.is_early_access).length}, content_descriptorids seen: ${hist(items.flatMap((i) => i.content_descriptorids ?? []))}.`);
}

async function probeAppReviews(): Promise<void> {
  const add = section('Steam IUserReviewsService/GetAppReviews (exact positive/negative totals)');
  const base = 'https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/';
  const variants: Array<[string, Record<string, unknown>]> = [
    ['purchase_type=0 (Steam), languages=["all"]', { appid: 620, languages: ['all'], filter: 1, review_type: 0, purchase_type: 0, num_per_page: 1, cursor: '*' }],
    ['purchase_type=1 (All), languages=["all"]', { appid: 620, languages: ['all'], filter: 1, review_type: 0, purchase_type: 1, num_per_page: 1, cursor: '*' }],
    ['defaults (english only, Steam purchases)', { appid: 620, num_per_page: 1 }],
  ];
  const results: Record<string, unknown> = {};
  for (const [label, input] of variants) {
    const res = await rlFetch(`${base}?input_json=${encodeURIComponent(JSON.stringify(input))}`, { log });
    const d = json<{ response?: { query_summary?: Record<string, unknown> } }>(res.text);
    results[label] = { status: res.status, query_summary: d?.response?.query_summary };
    add(`- ${label}: HTTP ${res.status} -> \`${JSON.stringify(d?.response?.query_summary)}\``);
  }
  await save('steam-getappreviews-620-variants.json', JSON.stringify(results, null, 2));
  add(`- Enums (docs page https://partner.steamgames.com/doc/webapi/IUserReviewsService): EUserReviewsPurchaseType 0=Steam, 1=All, 2=NonSteamPurchase; EUserReviewsReviewType 0=All, 1=Positive, 2=Negative; filter 0=Helpful, 1=Recent. The language parameter is \`languages\` (array); a \`language\` string is silently ignored and falls back to English only.`);
  add(`- The Steam store page for Portal 2 shows "Total reviews in all languages: 393,028" (read in a browser while probing). That matches **purchase_type=0 (Steam purchases) + languages=["all"]** and GetItems' \`summary_filtered.review_count\`, not purchase_type=All (which also counts key activations and is ~20% higher). So the pipeline uses purchase_type 0 + languages all.`);
  add(`- \`query_summary\` is present on the first page with review_type=All; \`total_positive\`/\`total_negative\`/\`total_reviews\` are the exact counts. \`num_per_page: 1\` keeps the payload under 1 KB (0 falls back to 20). No key. Rate: 1 request/second per the api.steampowered.com queue.`);
  const old = await rlFetch('https://store.steampowered.com/appreviews/620?json=1&language=all&purchase_type=all&num_per_page=0', { log, backoffRetries: 0 });
  await save('steam-appreviews-old-endpoint.txt', `HTTP ${old.status}\nlocation: ${old.headers.get('location')}\n\n${old.text.slice(0, 500)}`);
  add(`- Old \`store.steampowered.com/appreviews/<appid>?json=1\`: HTTP ${old.status}${old.headers.get('location') ? ` -> ${old.headers.get('location')}` : ''}, no JSON. Dead, as the brief said.`);
}

async function probeCategoriesAndTags(): Promise<void> {
  const add = section('Steam category ids and tag names');
  const { data, res } = await rlJson<{ response?: { categories?: Array<{ categoryid: number; type: number; display_name: string }> } }>('https://api.steampowered.com/IStoreBrowseService/GetStoreCategories/v1/?language=english', { log });
  await save('steam-getstorecategories.json', res.text);
  const cats = data?.response?.categories ?? [];
  const byId = new Map(cats.map((c) => [c.categoryid, c]));
  const expected: Array<[number, string]> = [[9, 'Co-op'], [38, 'Online Co-op'], [39, 'Shared/Split Screen Co-op'], [48, 'LAN Co-op'], [44, 'Remote Play Together'], [20, 'MMO'], [27, 'Cross-Platform Multiplayer'], [24, 'Shared/Split Screen'], [36, 'Online PvP'], [49, 'PvP']];
  add(`- \`IStoreBrowseService/GetStoreCategories/v1/?language=english\`: HTTP ${res.status}, ${cats.length} categories with \`categoryid\`, \`type\`, \`display_name\`.`);
  for (const [id, name] of expected) {
    const c = byId.get(id);
    add(`  - ${id} expected "${name}": live display_name="${c?.display_name ?? 'MISSING'}" ${c?.display_name === name ? 'OK' : '!! MISMATCH'}`);
  }
  const coopNamed = cats.filter((c) => /co-?op/i.test(c.display_name));
  add(`- Every category whose name contains "co-op": ${coopNamed.map((c) => `${c.categoryid} ${c.display_name}`).join('; ')}. Unknown co-op categories beyond 9/38/39/48: ${coopNamed.filter((c) => ![9, 38, 39, 48].includes(c.categoryid)).map((c) => c.categoryid).join(', ') || 'none'}.`);
  add(`- GetItems puts 9/38/39/48/20/27/24/36/49 in \`categories.supported_player_categoryids\` and 44 (Remote Play Together) in \`categories.feature_categoryids\`; appdetails lists them all under \`categories[]\` with \`description\` text. Both are matched on id and on name.`);
  add(`- Early Access in appdetails is genre id "70" (\`genres[].id\` is a string there). In GetItems it is \`is_early_access: true\`. Content descriptors: GetItems \`content_descriptorids\`, appdetails \`content_descriptors.ids\`; 3 and 4 are the adult-only ones (seen in the wild: 1, 2, 5).`);

  const tl = await rlJson<{ response?: { tags?: Array<{ tagid: number; name: string }> } }>('https://api.steampowered.com/IStoreService/GetTagList/v1/?language=english', { log });
  await save('steam-gettaglist.json', tl.res.text);
  const tags = tl.data?.response?.tags ?? [];
  const tagById = new Map(tags.map((t) => [t.tagid, t.name]));
  add(`- \`IStoreService/GetTagList/v1/?language=english\`: HTTP ${tl.res.status}, ${tags.length} tags (\`tagid\`, \`name\`). Co-op related: ${COOP_TAGIDS.map((id) => `${id}=${tagById.get(id)}`).join(', ')}. GetItems returns tag ids, so this is the tag-name source (no SteamSpy appdetails needed).`);
}

// ---------------------------------------------------------------------------
async function probeStoreApi(): Promise<void> {
  const add = section('Steam store.steampowered.com (fallback appdetails, batched prices, storesearch)');
  const res = await rlFetch('https://store.steampowered.com/api/appdetails?appids=620&cc=us&l=english', { log });
  await save('steam-appdetails-620.json', res.text);
  const d = json<Record<string, { success: boolean; data: Record<string, any> }>>(res.text)?.['620'];
  const data = d?.data ?? {};
  add(`- \`/api/appdetails?appids=620&cc=us&l=english\`: HTTP ${res.status}, success=${d?.success}, ${res.text.length.toLocaleString()} bytes, ${res.ms} ms. Cache-Control: ${res.headers.get('cache-control')}.`);
  add(`- Fields: type="${data.type}", is_free=${data.is_free}, release_date={coming_soon ${data.release_date?.coming_soon}, date "${data.release_date?.date}"}, price_overview={initial ${data.price_overview?.initial}, final ${data.price_overview?.final}, discount_percent ${data.price_overview?.discount_percent}}, categories=[${(data.categories ?? []).map((c: any) => `${c.id}:${c.description}`).slice(0, 8).join(', ')} ...], genres=[${(data.genres ?? []).map((g: any) => `${g.id}:${g.description}`).join(', ')}], content_descriptors.ids=[${data.content_descriptors?.ids}], recommendations.total=${data.recommendations?.total}, header_image=${data.header_image}`);
  add(`- One appid per call for full details. Limit is about 200 calls per 5 minutes per IP, so the queue waits 1.6 s between calls and backs off 5 minutes on 429/403. Kept only as a fallback for the checker function; the pipeline uses GetItems/Query.`);

  const res2 = await rlFetch('https://store.steampowered.com/api/appdetails?appids=620,548430,1446780&cc=us&l=english&filters=price_overview', { log });
  await save('steam-appdetails-batch-price.json', res2.text);
  const b = json<Record<string, { success: boolean; data?: { price_overview?: { final: number } } }>>(res2.text) ?? {};
  add(`- Batched \`appids=620,548430,1446780&filters=price_overview\`: HTTP ${res2.status}, ${Object.keys(b).length} entries, finals ${Object.entries(b).map(([k, v]) => `${k}=${v.data?.price_overview?.final}`).join(', ')}. Works, but GetItems does the same with 100 ids and richer data, so it is unused.`);

  const res3 = await rlFetch('https://store.steampowered.com/api/storesearch/?term=portal%202&cc=us&l=english', { log });
  await save('steam-storesearch-portal2.json', res3.text);
  const s = json<{ total: number; items: Array<{ id: number; name: string; type: string; price?: { final: number } }> }>(res3.text);
  add(`- \`/api/storesearch/?term=portal%202&cc=us&l=english\`: HTTP ${res3.status}, total=${s?.total}, first: ${s?.items?.slice(0, 3).map((i) => `${i.id} ${i.name} (${i.type})`).join('; ')}. Works without a key; items carry id, name, type, price, tiny_image.`);
}

// ---------------------------------------------------------------------------
async function probePcgw(): Promise<void> {
  const add = section('PCGamingWiki: max player counts');
  const api = 'https://www.pcgamingwiki.com/w/api.php';
  const f = await rlFetch(`${api}?action=cargofields&table=Multiplayer&format=json`, { log });
  await save('pcgw-cargofields-multiplayer.json', f.text);
  const fields = Object.keys(json<{ cargofields?: Record<string, unknown> }>(f.text)?.cargofields ?? {});
  add(`- \`action=cargofields&table=Multiplayer\`: HTTP ${f.status}, fields: ${fields.join(', ')}.`);
  const t = await rlFetch(`${api}?action=cargotables&format=json`, { log });
  await save('pcgw-cargotables.json', t.text);
  add(`- \`action=cargotables\`: ${(json<{ cargotables?: string[] }>(t.text)?.cargotables ?? []).join(', ')}. There is no \`Infobox_game\` table any more.`);
  const q = await rlFetch(`${api}?action=cargoquery&tables=Multiplayer&fields=_pageName,Online_players&limit=3&format=json`, { log });
  await save('pcgw-cargoquery-denied.json', q.text);
  const qerr = json<{ error?: { code: string; info: string } }>(q.text)?.error;
  add(`- \`action=cargoquery\` (any table, with or without a join): HTTP ${q.status}, error \`${qerr?.code}\`: "${qerr?.info}". **The Cargo query API is closed to anonymous callers**, and Special:CargoExport sits behind a browser challenge (HTTP 403). The brief's join cannot be used.`);
  add(`- What works instead: the ordinary MediaWiki API. \`action=query&prop=revisions&rvprop=content&rvslots=main&titles=A|B|...\` returns the wikitext of up to 50 pages per request (redirects followed with \`redirects=1\`). The page carries \`{{Network/Multiplayer |local play=true |local play players=2 |lan play=... |online play=true |online play players=2 ...}}\` and the infobox carries \`|steam appid = 620\` and \`|steam appid side = ...\`, which verifies the match.`);
  const titles = ['Portal 2', 'Deep Rock Galactic', 'Monster Hunter Rise', 'Brotato', 'PEAK', 'Lethal Company'];
  const r = await rlFetch(`${api}?action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(titles.join('|'))}`, { log });
  await save('pcgw-revisions-testset.json', r.text);
  const pages = json<{ query?: { pages?: Array<{ title: string; missing?: boolean; revisions?: Array<{ slots: { main: { content: string } } }> }> } }>(r.text)?.query?.pages ?? [];
  add(`- Test batch (${titles.join(', ')}): HTTP ${r.status}, ${r.text.length.toLocaleString()} bytes.`);
  for (const p of pages) {
    const wt = p.revisions?.[0]?.slots.main.content ?? '';
    const mp = parseMultiplayer(wt);
    const ids = parseSteamAppIds(wt);
    add(`  - "${p.title}": ${p.missing ? 'missing' : `appid=${ids.primary} side=[${ids.side.join(',')}] multiplayer=${mp ? `local ${mp.local.state}/${mp.local.players}, lan ${mp.lan.state}/${mp.lan.players}, online ${mp.online.state}/${mp.online.players}` : 'no template'}`}`);
  }
  const s = await rlFetch(`${api}?action=query&list=search&srsearch=548430&srwhat=text&srlimit=5&format=json`, { log });
  await save('pcgw-search-appid-548430.json', s.text);
  const hits = json<{ query?: { search?: Array<{ title: string }> } }>(s.text)?.query?.search ?? [];
  add(`- Title lookup when the Steam name is not the page title: \`action=query&list=search&srsearch=<appid>&srwhat=text\` (plain text search; OR/insource operators are not supported here). "548430" -> ${hits.map((h) => h.title).join(', ') || 'no hits'}. Candidates are then verified against the infobox appid.`);
  add(`- Plan: try Steam names in batches of up to 50 titles (after stripping ™ and ®), verify by appid, fall back to one text search per unresolved appid. Misses are cached for 30 days too. User-Agent: \`${USER_AGENT}\`. Rate: 1 request/second.`);
}

// ---------------------------------------------------------------------------
async function probeCapsules(): Promise<void> {
  const add = section('Portrait cover art (library capsule) URL pattern');
  const checks: Array<[string, string]> = [
    ['Portal 2, plain path', 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/library_600x900.jpg'],
    ['Valheim, hashed asset path from GetItems', 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/892970/3dee2eb67bca0660c5ca3c9e1cfbdfc1063333ba/library_capsule.jpg'],
    ['Valheim, plain path', 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/892970/library_600x900.jpg'],
    ['PEAK, plain path (expected 404)', 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3527290/library_600x900.jpg'],
    ['PEAK, hashed asset path', 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3527290/480bd879ac737921bfa2529a6fea15961267ad21/library_600x900.jpg'],
    ['Nonexistent app', 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/999999999/library_600x900.jpg'],
  ];
  const lines: string[] = [];
  for (const [label, url] of checks) {
    const res = await rlFetch(url, { method: 'HEAD', log });
    lines.push(`${label}: HTTP ${res.status} ${res.headers.get('content-type')} ${url}`);
  }
  await save('steam-capsule-head-checks.txt', lines.join('\n'));
  for (const l of lines) add(`- ${l}`);
  add(`- Conclusion: hotlink \`https://shared.akamai.steamstatic.com/store_item_assets/\` + asset_url_format with the \`assets.library_capsule\` filename. The CDN serves them with permissive caching and no referer checks. When the field is absent, \`cap\` is null and the UI center-crops \`img\` (header.jpg).`);
}

// ---------------------------------------------------------------------------
async function writeProbeMd(): Promise<void> {
  const out: string[] = [];
  out.push('# PROBE.md - data source probe results');
  out.push('');
  out.push(`Generated by \`pipeline/probe.ts\` on ${new Date().toISOString()}. Raw responses are in \`pipeline/samples/\`. Every statement below was measured by this run unless it says "manual".`);
  out.push('');
  out.push('## Summary');
  out.push('');
  out.push('| Need | Source | Works | Key | Notes |');
  out.push('|---|---|---|---|---|');
  out.push('| GeForce NOW support | `static.nvidiagrid.net/.../gfnpc-en-US.json` | answers, but stale (March 2022) | no | 1,144 Steam ids; misses everything added since 2022 |');
  out.push('| GeForce NOW support | `POST api-prod.nvidia.com/services/gfngames/v1/gameList` (GraphQL) | **yes** | no | the GFN website\'s own catalog; needs a valid `vpcId`; no "optimized" flag |');
  out.push('| Candidates | SteamSpy `request=tag` | yes, partial | no | ~900 games across the three tags; 1 tag request/minute |');
  out.push('| Candidates + store data | `IStoreQueryService/Query` with `tagids_must_match` | **yes** | no | complete tag match with full store items, 500 per page |');
  out.push('| Store data, batched | `IStoreBrowseService/GetItems` | **yes** | no | 100 ids per call; EA flag, price, categories, assets, review summary |');
  out.push('| Store data, single | `store.steampowered.com/api/appdetails` | yes | no | fallback for the checker; 1.6 s gap |');
  out.push('| Review totals | `IUserReviewsService/GetAppReviews` | **yes** | no | purchase_type 0 + languages ["all"] matches the store headline |');
  out.push('| Review totals (old) | `store.steampowered.com/appreviews` | dead (redirects) | - | as the brief said |');
  out.push('| Max players | PCGamingWiki Cargo API | **no** (permission denied) | - | replaced by wikitext parsing via the MediaWiki API |');
  out.push('| Max players | PCGamingWiki `prop=revisions` wikitext | **yes** | no | 50 pages per request; `{{Network/Multiplayer}}` template |');
  out.push('| Portrait art | `assets.library_capsule` via asset_url_format | **yes** | no | 100% of probed games; never guess the path |');
  out.push('| Name -> appid | `store.steampowered.com/api/storesearch` | **yes** | no | used by the checker |');
  out.push('| Tag names | `IStoreService/GetTagList` | **yes** | no | 446 tags |');
  out.push('');
  for (const s of sections) {
    out.push(`## ${s.title}`);
    out.push('');
    out.push(...s.lines);
    out.push('');
  }
  out.push('## Decisions taken from this probe');
  out.push('');
  out.push('1. **GeForce NOW comes from the GraphQL catalog, not the static file.** The static file still responds, so a naive check would have called it healthy; its `last-modified` and the missing 2024+ titles prove it is frozen. `optimized` is null for every game until NVIDIA exposes a flag again.');
  out.push('2. **Candidates come from Steam\'s own tag query, with SteamSpy and picks.json as additional seeds.** SteamSpy\'s tag endpoint only returns its top ~800 games per tag, which would hide exactly the small games this site is for. The Query endpoint returns every tagged game and the store record in the same response, so the "store data" stage costs about 30 requests instead of thousands.');
  out.push('3. **Exact review counts come from GetAppReviews with purchase_type=0 and languages=["all"]**, because that is the combination that reproduces the number on the store page. GetItems\' summary is used to skip games that cannot pass the 100-review / 70% bar before spending a request on them.');
  out.push('4. **PCGamingWiki is read through wikitext, not Cargo.** Cargo is closed to anonymous callers. Page titles are tried in batches of 50 first, with a per-appid text search as the fallback.');
  out.push('5. **No Steam API key is required** for any endpoint used. `STEAM_API_KEY` is passed through when present but nothing depends on it.');
  out.push('');
  await writeFile(path.join(HERE, 'PROBE.md'), out.join('\n'));
}

async function main(): Promise<void> {
  await mkdir(SAMPLES, { recursive: true });
  // Different hosts run concurrently; the per-host queues keep each host serial.
  await Promise.all([
    safely('GeForce NOW static list', probeGfnStatic).then(() => safely('GeForce NOW GraphQL catalog', probeGfnGraphql)),
    safely('SteamSpy', probeSteamSpy),
    safely('Steam GetItems', probeGetItems)
      .then(() => safely('Steam Query', probeStoreQuery))
      .then(() => safely('Steam GetAppReviews', probeAppReviews))
      .then(() => safely('Steam categories and tags', probeCategoriesAndTags)),
    safely('Steam store API', probeStoreApi),
    safely('PCGamingWiki', probePcgw),
    safely('Capsule art', probeCapsules),
  ]);
  await writeProbeMd();
  console.log(`\nWrote ${path.join(HERE, 'PROBE.md')} and ${sections.length} sections; samples in ${SAMPLES}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
