// GeForce NOW catalog from NVIDIA's own GraphQL endpoint (the one the GFN
// website uses). See PROBE.md for why the static JSON is not used.

import { rlFetch } from './http.ts';

export const GFN_ENDPOINT = 'https://api-prod.nvidia.com/services/gfngames/v1/gameList';
/** Any valid region id works; availability is the same across the US regions we tried. */
export const GFN_VPC = process.env.GFN_VPC_ID ?? 'NP-SJC6-04';

type Variant = { id: string; appStore: string; osType: string; storeId: string | null; gfn: { status: string | null; releaseDate: string | null } | null };
type App = { id: string; title: string; sortName: string; variants: Variant[] };
type Page = { data?: { apps?: { numberReturned: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; items: App[] } }; errors?: Array<{ message: string }> };

export type GfnEntry = { status: string; title: string };

/** Steam appid -> GFN status for every Steam variant in the catalog. */
export async function fetchGfnSteamCatalog(log?: (l: string) => void): Promise<Map<number, GfnEntry>> {
  const out = new Map<number, GfnEntry>();
  let after: string | null = null;
  for (let page = 0; page < 60; page++) {
    const q = `{apps(country:"US",language:"en_US",vpcId:"${GFN_VPC}",first:750${after ? `,after:"${after}"` : ''}){numberReturned pageInfo{hasNextPage endCursor}items{id title sortName variants{id appStore osType storeId gfn{status releaseDate}}}}}`;
    const res = await rlFetch(GFN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: q, log, timeoutMs: 60_000 });
    if (!res.ok) throw new Error(`GFN catalog HTTP ${res.status}: ${res.text.slice(0, 200)}`);
    const data = JSON.parse(res.text) as Page;
    const apps = data.data?.apps;
    if (!apps) throw new Error(`GFN catalog: no data (${JSON.stringify(data.errors ?? []).slice(0, 200)})`);
    for (const app of apps.items) {
      for (const v of app.variants) {
        if (v.appStore !== 'STEAM' || !v.storeId || !/^\d+$/.test(v.storeId)) continue;
        const status = v.gfn?.status ?? 'null';
        const id = Number(v.storeId);
        const prev = out.get(id);
        // Prefer the "most available" status when a game has several Steam variants.
        if (!prev || rank(status) > rank(prev.status)) out.set(id, { status, title: app.title });
      }
    }
    if (!apps.pageInfo.hasNextPage || !apps.pageInfo.endCursor) break;
    after = apps.pageInfo.endCursor;
  }
  if (out.size < 1000) throw new Error(`GFN catalog looks truncated: only ${out.size} Steam apps`);
  return out;
}

function rank(status: string): number {
  switch (status) {
    case 'AVAILABLE':
      return 3;
    case 'PATCHING':
      return 2;
    case 'SERVER_MAINTENANCE':
      return 1;
    default:
      return 0;
  }
}

/** A game is "on GeForce NOW" when NVIDIA lists its Steam build with a real status. */
export function gfnSupported(entry: GfnEntry | undefined): boolean {
  return !!entry && rank(entry.status) > 0;
}
