// Phase 4 checks 3 and 4: Early Access games are hidden by default and shown
// with a badge when the toggle is on; games that are not on GeForce NOW are
// hidden while the GeForce NOW filter is on.
//
//   node design/verify-filters.mjs [baseUrl] "EA game 1" "EA game 2" "EA game 3" -- "non-GFN game 1" "non-GFN game 2"

import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const base = argv[0] ?? 'http://localhost:4173';
const sep = argv.indexOf('--');
const eaNames = argv.slice(1, sep < 0 ? undefined : sep);
const nonGfnNames = sep < 0 ? [] : argv.slice(sep + 1);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

async function allCards(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.results-head h1 span', { timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll('.grid .card, .empty').length > 0, null, { timeout: 30_000 });
  const total = Number((await page.$eval('.results-head h1 span', (el) => el.textContent.trim())).replace(/,/g, ''));
  let count = 0;
  for (let i = 0; i < 80; i++) {
    count = await page.$$eval('.grid .card', (els) => els.length);
    if (count >= total) break;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(250);
  }
  const cards = await page.$$eval('.grid .card', (els) =>
    els.map((el) => ({ name: el.querySelector('.name').textContent.trim(), ea: !!el.querySelector('.badge.ea'), gfn: !!el.querySelector('.badge.gfn') })),
  );
  return { total, cards };
}

let ok = true;
const report = (pass, msg) => {
  ok = ok && pass;
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${msg}`);
};

const def = await allCards(base + '/');
console.log(`default view: ${def.total} results, ${def.cards.length} cards rendered`);
for (const n of eaNames) report(!def.cards.some((c) => c.name === n), `"${n}" hidden by default (Early Access)`);
for (const n of nonGfnNames) report(!def.cards.some((c) => c.name === n), `"${n}" hidden by default (not on GeForce NOW)`);
report(def.cards.every((c) => c.gfn), 'every default card carries the GeForce NOW badge');
report(def.cards.every((c) => !c.ea), 'no default card carries the Early Access badge');

const ea = await allCards(base + '/?ea=1&price=60&rev=100&pct=70');
console.log(`early access shown: ${ea.total} results`);
for (const n of eaNames) {
  const c = ea.cards.find((c) => c.name === n);
  report(!!c && c.ea, `"${n}" visible with the Early Access badge when the toggle is on`);
}

const gfn = await allCards(base + '/?gfn=0&price=60&rev=100&pct=70');
console.log(`geforce now off: ${gfn.total} results`);
for (const n of nonGfnNames) report(gfn.cards.some((c) => c.name === n), `"${n}" visible when GeForce NOW only is off`);

await browser.close();
process.exit(ok ? 0 : 1);
