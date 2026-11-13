import type { Game } from '@shared/types';
import { usdShort } from './format';
import { steamStoreUrl } from './data';

const KEY = 'coop-finder:shortlist:v1';

export function readShortlist(): number[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((n) => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

export function writeShortlist(ids: number[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* private mode or quota: the in-memory list still works for this session */
  }
}

/** One game per line: Name - $X - 94% positive - <steam link> */
export function shortlistText(games: Game[]): string {
  return games.map((g) => `${g.name} - ${usdShort(g.price.now)} - ${g.rev.pct}% positive - ${steamStoreUrl(g.id)}`).join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
