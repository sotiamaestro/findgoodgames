// PCGamingWiki helpers: parse the {{Network/Multiplayer}} template and the
// Steam app ids out of a page's wikitext.

export type PcgwMode = {
  /** Raw value of "<mode> play": true, false, limited, hackable, always, unknown ... */
  state: string | null;
  players: number | null;
  modes: string | null;
};

export type PcgwMultiplayer = {
  local: PcgwMode;
  lan: PcgwMode;
  online: PcgwMode;
};

const MODE_KEYS = ['local', 'lan', 'online'] as const;

function templateBody(wikitext: string, name: string): string | null {
  const start = wikitext.indexOf(`{{${name}`);
  if (start < 0) return null;
  // Walk to the matching closing braces, allowing nested templates.
  let depth = 0;
  for (let i = start; i < wikitext.length - 1; i++) {
    const two = wikitext.slice(i, i + 2);
    if (two === '{{') {
      depth++;
      i++;
    } else if (two === '}}') {
      depth--;
      i++;
      if (depth === 0) return wikitext.slice(start, i + 1);
    }
  }
  return null;
}

function templateParams(body: string): Map<string, string> {
  const params = new Map<string, string>();
  // Split on top-level pipes only.
  let depth = 0;
  let current = '';
  const parts: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '{{' || two === '[[') {
      depth++;
      current += two;
      i++;
    } else if (two === '}}' || two === ']]') {
      depth--;
      current += two;
      i++;
    } else if (body[i] === '|' && depth <= 1) {
      parts.push(current);
      current = '';
    } else {
      current += body[i];
    }
  }
  parts.push(current);
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim().replace(/\s*}}\s*$/, '').trim();
    params.set(key, value);
  }
  return params;
}

function firstInt(value: string | undefined): number | null {
  if (!value) return null;
  const m = value.match(/\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) && n > 0 && n < 100_000_000 ? n : null;
}

/** Parse the Network/Multiplayer template. Returns null when the page has none. */
export function parseMultiplayer(wikitext: string): PcgwMultiplayer | null {
  const body = templateBody(wikitext, 'Network/Multiplayer');
  if (!body) return null;
  const p = templateParams(body);
  const out = {} as PcgwMultiplayer;
  for (const key of MODE_KEYS) {
    const state = p.get(`${key} play`)?.toLowerCase() || null;
    // Player counts in the template are the maximum for that mode. Take the
    // largest integer when a range is given ("2-4").
    const playersRaw = p.get(`${key} play players`);
    let players: number | null = null;
    if (playersRaw) {
      const nums = playersRaw.match(/\d+/g)?.map((n) => parseInt(n, 10)).filter((n) => n > 0 && n < 100000) ?? [];
      players = nums.length ? Math.max(...nums) : null;
    }
    out[key] = { state, players, modes: p.get(`${key} play modes`) || null };
  }
  return out;
}

/** Steam app ids from the infobox: primary first, then "side" ids. */
export function parseSteamAppIds(wikitext: string): { primary: number | null; side: number[] } {
  const primary = firstInt(wikitext.match(/\|\s*steam appid\s*=\s*([^\n|]*)/i)?.[1]);
  const sideRaw = wikitext.match(/\|\s*steam appid side\s*=\s*([^\n|]*)/i)?.[1] ?? '';
  const side = (sideRaw.match(/\d+/g) ?? []).map((n) => parseInt(n, 10)).filter((n) => n > 0);
  return { primary, side };
}

/** True when a mode's state means the mode exists (including limited / hackable). */
export function modeExists(state: string | null): boolean {
  return state === 'true' || state === 'limited' || state === 'hackable' || state === 'always';
}
