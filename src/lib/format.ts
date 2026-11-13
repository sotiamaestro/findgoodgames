import type { Game } from '@shared/types';

export function usd(cents: number): string {
  if (cents === 0) return 'Free';
  return `$${(cents / 100).toFixed(2)}`;
}

export function usdShort(cents: number): string {
  if (cents === 0) return 'Free';
  const v = cents / 100;
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function timeAgo(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'unknown';
  const h = Math.floor(ms / 3600_000);
  if (h < 1) return 'under an hour ago';
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} days ago`;
}

export function year(iso: string): string {
  return iso ? iso.slice(0, 4) : '';
}

export function longDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function modeChips(g: Game): string[] {
  const out: string[] = [];
  if (g.coop.online) out.push('Online');
  if (g.coop.local) out.push(g.coop.split ? 'Split screen' : 'Local');
  if (g.coop.lan) out.push('LAN');
  if (g.coop.rpt) out.push('Remote Play');
  return out;
}

export function playersLabel(g: Game, preferLocal = false): { text: string; known: boolean } {
  const p = g.players;
  if (!p) return { text: '? players', known: false };
  const online = p.online;
  const local = p.local;
  if (preferLocal && local) return { text: `${local} local`, known: true };
  if (online && local && online !== local) return { text: `${online} online, ${local} local`, known: true };
  if (online) return { text: `${online} players`, known: true };
  if (local) return { text: `${local} local`, known: true };
  return { text: '? players', known: false };
}

export function oneCopy(g: Game): boolean {
  return g.coop.rpt && g.coop.local;
}

/** Group cost: price x party, or the price alone when one copy is enough. */
export function groupCost(g: Game, party: number): { cents: number; copies: number } {
  if (g.price.now === 0) return { cents: 0, copies: 0 };
  if (oneCopy(g)) return { cents: g.price.now, copies: 1 };
  return { cents: g.price.now * party, copies: party };
}
