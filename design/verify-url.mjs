// Phase 4 check 6: a copied filter URL opened in a fresh browser context shows
// the same results. Also checks that the bare URL equals the defaults.
//
//   node design/verify-url.mjs [baseUrl]

import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173';
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function resultsFor(url) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.results-head h1 span', { timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll('.grid .card, .empty').length > 0, null, { timeout: 30_000 });
  const count = await page.$eval('.results-head h1 span', (el) => el.textContent.trim());
  const names = await page.$$eval('.grid .card .name', (els) => els.slice(0, 12).map((e) => e.textContent.trim()));
  const chips = await page.$$eval('.active-filters .chip', (els) => els.map((e) => e.textContent.trim()));
  const href = page.url();
  await ctx.close();
  return { count, names, chips, href };
}

// Session A: start from defaults and change filters through the UI (desktop rail), then copy the URL.
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const pageA = await ctxA.newPage();
await pageA.goto(base + '/', { waitUntil: 'domcontentloaded' });
await pageA.waitForSelector('.rail .frow');
await pageA.waitForFunction(() => document.querySelectorAll('.grid .card, .empty').length > 0);
// Party size 2, show Early Access, turn GeForce NOW off, price $60+ via the slider, sort by newest.
await pageA.click('.rail .frow:has-text("Party size")');
await pageA.click('.rail .seg button:has-text("2")');
await pageA.click('.rail .frow:has-text("Show Early Access") .switch');
await pageA.click('.rail .frow:has-text("GeForce NOW only") .switch');
await pageA.click('.rail .frow:has-text("Max price")');
await pageA.$eval('.rail input[type=range]', (el) => {
  el.value = '60';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await pageA.click('.rail .frow:has-text("Sort by")');
await pageA.click('.rail .optlist button:has-text("Newest")');
await pageA.waitForTimeout(300);
const copied = pageA.url();
const countA = await pageA.$eval('.results-head h1 span', (el) => el.textContent.trim());
const namesA = await pageA.$$eval('.grid .card .name', (els) => els.slice(0, 12).map((e) => e.textContent.trim()));
await ctxA.close();

const fresh = await resultsFor(copied);
const bare = await resultsFor(base + '/');

console.log('copied URL:', copied);
console.log('session A:', countA, namesA.slice(0, 5));
console.log('fresh ctx:', fresh.count, fresh.names.slice(0, 5));
console.log('fresh chips:', fresh.chips.join(' | '));
console.log('bare URL  :', bare.count, 'chips:', bare.chips.join(' | '));
const same = countA === fresh.count && JSON.stringify(namesA) === JSON.stringify(fresh.names);
const defaults = bare.chips.join('|') === 'Up to $20|4 players|GeForce NOW|85%+|200+ reviews';
console.log(same ? 'PASS: fresh browser shows the same results' : 'FAIL: results differ');
console.log(defaults ? 'PASS: bare URL shows the default filters' : 'FAIL: bare URL chips: ' + bare.chips.join('|'));
await browser.close();
process.exit(same && defaults ? 0 : 1);
