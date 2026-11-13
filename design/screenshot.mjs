// Takes the 375px-wide review screenshots with the locally installed Chrome.
//
//   node design/screenshot.mjs [baseUrl]   (default http://localhost:4173, i.e. `vite preview`)
//
// Writes design/shots/*.png: home grid, filter sheet, game detail, shortlist, check a game.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] ?? 'http://localhost:4173';
const out = new URL('./shots/', import.meta.url).pathname;
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
const page = await ctx.newPage();

async function ready() {
  await page.waitForSelector('.grid .card', { timeout: 30_000 });
  await page.waitForTimeout(800);
}

// 1. Home grid (scrolled past the rows so the grid itself is in view).
await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
await ready();
await page.screenshot({ path: out + 'home-top.png' });
const grid = await page.$('.results-head');
await grid.scrollIntoViewIfNeeded();
await page.waitForTimeout(1200);
await page.screenshot({ path: out + 'home-grid.png' });

// 2. Filter sheet.
await page.click('.mobile-tools .pillbtn:has-text("Filters")');
await page.waitForSelector('.sheet .frow');
await page.waitForTimeout(300);
await page.screenshot({ path: out + 'filter-sheet.png' });
await page.click('.sheet .frow:has-text("Max price")');
await page.waitForTimeout(300);
await page.screenshot({ path: out + 'filter-sheet-price.png' });
await page.click('.sheet-head .left button');

// 3. Game detail: first card in the grid.
await page.click('.grid .card a');
await page.waitForSelector('.detail-title');
await page.waitForTimeout(1200);
await page.screenshot({ path: out + 'detail.png' });
await page.screenshot({ path: out + 'detail-full.png', fullPage: false });
// Save it to the shortlist from the detail view, then close.
await page.click('.detail-body .btnrow button');
await page.waitForTimeout(300);
await page.click('.sheet-head .left button');
await page.waitForTimeout(300);

// Add two more games to the shortlist from the grid.
const saves = await page.$$('.grid .card .save');
for (const s of saves.slice(1, 3)) {
  await s.click();
  await page.waitForTimeout(200);
}

// 4. Shortlist.
await page.click('.topbar .iconbtn');
await page.waitForSelector('.ranked li');
await page.waitForTimeout(1200);
await page.screenshot({ path: out + 'shortlist.png' });

// 5. Check a game (dataset hit).
await page.goto(base + '/?check=portal', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.check-row, .verdict, .notice', { timeout: 30_000 });
await page.waitForTimeout(800);
await page.screenshot({ path: out + 'check-results.png' });

await browser.close();
console.log('wrote screenshots to', out);
