// Shared between the pipeline, the Netlify function and the UI.

export type Game = {
  id: number; // Steam appid
  name: string;
  cap: string | null; // portrait 600x900 library capsule URL, hotlinked
  img: string; // landscape header image URL, hotlinked
  blurb: string; // short description, max 160 chars
  released: string; // ISO date (YYYY-MM-DD)
  price: { now: number; base: number; off: number; free: boolean }; // USD cents; off = discount %
  rev: { pos: number; neg: number; pct: number; wilson: number; label: string };
  coop: { online: boolean; local: boolean; lan: boolean; split: boolean; rpt: boolean }; // rpt = Remote Play Together
  players: { online: number | null; local: number | null } | null;
  gfn: { ok: boolean; optimized: boolean | null };
  ea: boolean;
  leftEaAt: string | null;
  tags: number[]; // indexes into Dataset.tagNames
  value: number;
  pick: string | null; // curated one-liner if the game is in picks.json
  best: string | null; // curated "best with" party size from picks.json
  /** Steam category 20 (MMO) present. Drives the "Hide MMOs" filter. */
  mmo: boolean;
};

export type Dataset = { generatedAt: string; tagNames: string[]; games: Game[] };

export type Pick = { appid: number; line: string; best?: string };

/** What the check-game function returns for a game that is not in the dataset. */
export type CheckResult = {
  id: number;
  name: string;
  type: string;
  img: string | null;
  cap: string | null;
  released: string | null;
  comingSoon: boolean;
  price: { now: number; base: number; off: number; free: boolean } | null;
  rev: { count: number; pct: number; label: string } | null;
  coop: Game['coop'];
  anyCoop: boolean;
  ea: boolean;
  gfn: boolean;
  adult: boolean;
  blurb: string;
  source: 'dataset' | 'live';
};
