// Seeds data/picks.json from a built games.json: the top N games by value that
// pass the UI defaults, plus any of the brief's seed titles that qualify.
// Lines are left for a human (or the maintainer) to write; this script only
// decides which games are eligible and prints their blurbs for reference.
//
//   tsx pipeline/seed-picks.ts [--data-dir .data] [--top 40] [--merge]
//
// --merge keeps lines already present in data/picks.json.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Dataset, Game, Pick } from '../shared/types.ts';
import { DEFAULT_FILTERS } from '../shared/config.ts';

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(opt('--data-dir') ?? path.join(ROOT, '.data'));
const TOP = Number(opt('--top') ?? 40);
const MERGE = args.includes('--merge');

const SEED_TITLES = [
  'Deep Rock Galactic',
  'PlateUp!',
  'Overcooked! 2',
  'Unrailed!',
  'PICO PARK',
  'Keep Talking and Nobody Explodes',
  'Lovers in a Dangerous Spacetime',
  'Risk of Rain 2',
  "Don't Starve Together",
  'Terraria',
  'Stardew Valley',
  'Raft',
  'Golf With Your Friends',
  'Human: Fall Flat',
  'Portal 2',
  'Operation: Tango',
  'Escape Simulator',
  'Ultimate Chicken Horse',
  'Castle Crashers',
  'Moving Out',
  'PEAK',
  'Content Warning',
  'Barony',
  'Gunfire Reborn',
  'We Were Here Together',
];

function passesDefaults(g: Game): boolean {
  const d = DEFAULT_FILTERS;
  return !g.ea && g.gfn.ok && !g.mmo && g.price.now <= d.maxPrice * 100 && g.rev.pct >= d.minPct && g.rev.pos + g.rev.neg >= d.minReviews;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

const dataset = JSON.parse(await readFile(path.join(DATA_DIR, 'games.json'), 'utf8')) as Dataset;
const byNorm = new Map(dataset.games.map((g) => [norm(g.name), g]));

const top = dataset.games.filter(passesDefaults).sort((a, b) => b.value - a.value).slice(0, TOP);
const seeds: Game[] = [];
const dropped: string[] = [];
for (const title of SEED_TITLES) {
  const g = byNorm.get(norm(title));
  if (!g) {
    dropped.push(`${title}: not in the dataset`);
    continue;
  }
  if (!passesDefaults(g)) {
    const why = [!g.gfn.ok && 'not on GeForce NOW', g.ea && 'Early Access', g.price.now > DEFAULT_FILTERS.maxPrice * 100 && `price $${(g.price.now / 100).toFixed(2)}`, g.rev.pct < DEFAULT_FILTERS.minPct && `${g.rev.pct}%`, g.rev.pos + g.rev.neg < DEFAULT_FILTERS.minReviews && 'too few reviews'].filter(Boolean).join(', ');
    dropped.push(`${title}: ${why}`);
    continue;
  }
  seeds.push(g);
}

const chosen = new Map<number, Game>();
for (const g of [...top, ...seeds]) chosen.set(g.id, g);

let existing = new Map<number, Pick>();
if (MERGE) {
  try {
    existing = new Map((JSON.parse(await readFile(path.join(ROOT, 'data', 'picks.json'), 'utf8')) as Pick[]).map((p) => [p.appid, p]));
  } catch {
    /* none yet */
  }
}

const picks: Pick[] = [...chosen.values()].map((g) => ({
  appid: g.id,
  line: existing.get(g.id)?.line ?? '',
  best: existing.get(g.id)?.best ?? (g.players?.online ? (g.players.online >= 8 ? '4-8 players' : g.players.online <= 2 ? '2 players' : `2-${g.players.online} players`) : ''),
}));

await mkdir(path.join(ROOT, 'data'), { recursive: true });
await writeFile(path.join(ROOT, 'data', 'picks.json'), JSON.stringify(picks, null, 2) + '\n');

console.log(`top ${TOP} by value passing defaults: ${top.length}; seed titles qualifying: ${seeds.length}; total picks: ${picks.length}`);
console.log('seed titles dropped:');
for (const d of dropped) console.log(`  - ${d}`);
console.log('\nreference for writing lines (id | name | price | pct | players | blurb):');
for (const g of chosen.values()) console.log(`${g.id} | ${g.name} | $${(g.price.now / 100).toFixed(2)} | ${g.rev.pct}% | ${g.players?.online ?? '?'} | ${g.blurb}`);
