# Build prompt: Co-op Finder (Netlify)

Save this file as `PROMPT.md` in an empty folder, open Claude Code there, and say: "Read PROMPT.md and build it."

Before starting, connect the Mobbin MCP to Claude Code (it needs Mobbin Pro, which I have). The Design system section depends on it.

---

## The problem

My friends and I want co-op games on Steam that are cheap, fully released, and actually great. Usually that means indie games built around one strong idea. They're hard to find. The ones that go viral on Instagram are often Early Access, and some don't run on GeForce NOW, which part of my group plays on. Build a site that answers one question fast: "what should our group buy and play tonight?"

## What a good result looks like

- The default view, with no clicks, shows co-op games that are fully released, cost $20 or less right now (sale prices count), are 85%+ positive, and run on GeForce NOW through Steam. They're ranked by value.
- Every fact on a card (price, Early Access status, GeForce NOW, co-op modes, review score) comes from live data. None of it is typed by hand.
- It loads fast on a phone, because people open these links from group chats.

## Hard rules

1. No hand-maintained facts. All facts come from the pipeline. The only hand-written content is the one-line blurbs in `data/picks.json`.
2. Verify every external endpoint before writing code against it (Phase 0). My notes on endpoints and field names below are a starting point. Where the live response disagrees with them, the live response is right.
3. Respect rate limits. Never send parallel requests to the same host.
4. Don't ask me anything you can settle by testing. Make the call, log it in `DECISIONS.md`, and keep going. Stop and ask only if a core data source (Steam store data or the GeForce NOW list) can't be used.
5. In site copy, use plain dashes and never em dashes.

## Architecture (with reasons - don't swap these out)

- **Frontend:** Vite + Preact + TypeScript, built as a static site and deployed on Netlify from a GitHub repo.
- **Data pipeline:** Node 22 + TypeScript (run with `tsx`), on a GitHub Actions schedule. Not on Netlify scheduled functions. Reason: scheduled functions stop after 30 seconds. The first full run of this pipeline takes 1-2 hours, because Steam's store endpoint allows about 200 requests per 5 minutes per IP.
- **Data hosting:** The pipeline commits `games.json` and its cache to an orphan `data` branch. The site fetches the file at runtime from jsDelivr (`https://cdn.jsdelivr.net/gh/<owner>/<repo>@data/games.json`), and the workflow purges jsDelivr's copy after every push. Reason: on Netlify's free plan, each production deploy costs 15 of the 300 monthly credits. Redeploying for every daily price refresh would use up the plan in under 3 weeks. With this setup, data refreshes cost no Netlify credits, and Netlify only redeploys when the code changes. **This means the repo has to be public.**
- **Data loading fallbacks:** jsDelivr, then raw.githubusercontent.com, then a snapshot bundled with the site at `/data/games.fallback.json`.
- **One Netlify Function** powers the "Check a game" feature (described below). It must finish in under 10 seconds, since the free plan's function timeout is that short.

## Phase 0 - Probe the data sources (do this first)

Write `pipeline/probe.ts`. It calls each source once, saves the raw responses to `pipeline/samples/`, and writes `pipeline/PROBE.md`. For each source, PROBE.md records whether it works, whether it needs a key, the confirmed field paths, and any rate limiting you saw. Use Portal 2 (appid 620) and a few other well-known co-op games as test cases.

| Need | Source | Notes |
|---|---|---|
| GeForce NOW support | `https://static.nvidiagrid.net/supported-public-game-list/locales/gfnpc-en-US.json` | One file covers the whole catalog. Use Steam entries only (check the store field and steamUrl), and pull the appid out of steamUrl. Save any "optimized" flag. If this URL is dead, find NVIDIA's current public list and document where it lives. |
| Co-op candidate list | SteamSpy: `https://steamspy.com/api.php?request=tag&tag=Co-op`, plus `Online Co-Op` and `Local Co-Op` | Returns appid, name, positive and negative counts, and price. The counts are approximate, so use them only to prefilter. Limits: about 1 request per second, and about 1 per minute for big requests. |
| Store data, batched (preferred) | `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=...` | Try it without a key first. If that fails, retry with the `STEAM_API_KEY` env var (a free key from https://steamcommunity.com/dev/apikey). One call can cover many appids and return categories, tags, release info including the Early Access flag, price, and a review summary. If it works, it makes the pipeline much faster. |
| Store data, one game at a time (fallback) | `https://store.steampowered.com/api/appdetails?appids=<id>&cc=us&l=english` | Full details come back for only one appid per call, and the limit is about 200 calls per 5 minutes per IP, so wait 1.6 s between calls. Also test whether `appids=a,b,c&filters=price_overview` works for batched price-only refreshes. |
| Review totals | `IUserReviewsService/GetAppReviews` (docs: https://partner.steamgames.com/doc/webapi/IUserReviewsService) | **Valve shut down `store.steampowered.com/appreviews/<appid>?json=1` on Oct 22, 2026. Do not use it.** The new endpoint takes its parameters in `input_json` and uses enums where the old one used strings. Score totals come back only on the first page, and only when the review type is All. Ask for 0-1 reviews per page, since all we need is `query_summary`. Use the same purchase-type and language settings the Steam store page uses for its headline score, so the numbers match the store (check this against real store pages). Skip this source if GetItems already returns reliable totals. |
| Max player counts | PCGamingWiki Cargo API: `https://www.pcgamingwiki.com/w/api.php?action=cargoquery...` | Join `Infobox_game` (Steam_AppID) with `Multiplayer`. Confirm the field names first with `action=cargofields&table=Multiplayer`. Query about 50 appids at a time, and send a descriptive User-Agent. Credit PCGamingWiki in the footer as its license requires. Many games have no data here, which is fine: store null. |
| Portrait cover art | Steam's library capsule, `.../steam/apps/<appid>/library_600x900.jpg`, or the asset fields GetItems returns | The design depends on portrait art (see Design system). Confirm the URL pattern and what share of our games have one. Store it as `cap`. When a game has none, fall back to a center-cropped header image. |
| Game name to appid (for the checker) | `https://store.steampowered.com/api/storesearch/?term=<q>&cc=us&l=english` | Verify it works. |
| Tag names | If GetItems returns tag IDs, map them to names with `IStoreService/GetTagList`. Otherwise use the tags from SteamSpy `request=appdetails`. | |

Steam category IDs I expect (confirm them against the samples, match on the description text as well, and log any unknown category with "co-op" in its name):
`9` Co-op, `38` Online Co-op, `39` Shared/Split Screen Co-op, `48` LAN Co-op, `44` Remote Play Together, `20` MMO, `27` Cross-Platform Multiplayer.
Early Access: genre id `70` (description "Early Access"), or the Early Access flag in GetItems.
Adult content descriptors to exclude: `3` and `4`.

Show me PROBE.md, then keep going without waiting for a reply.

## Phase 1 - Data pipeline

`pipeline/build-data.ts` has three modes: `--full` (weekly, and the default), `--prices` (daily), and `--limit N` (a small sample for development).

The funnel. Print the count left after each stage on every run:
1. **Candidates:** every game with a SteamSpy co-op tag, plus every appid in `data/picks.json`. Drop games with fewer than 100 total reviews by SteamSpy's count.
2. **Store data:** keep games where `type == game`, the game is released (not coming soon), it has at least one co-op category, and it isn't adult content. Keep Early Access games and games not on GeForce NOW, but flag them. The UI filters them out.
3. **Review totals:** replace the estimates with the real positive and negative counts.
4. **Inclusion:** keep games with 100+ reviews and 70%+ positive. The UI's default filters are stricter than this.
5. **GeForce NOW:** set the flag from NVIDIA's list.
6. **Player counts:** add them from PCGamingWiki.
7. **Output:** compute scores, update history, write the files.

Scoring. Put the constants in `shared/config.ts` so the UI uses the same values:
- `wilson`: the Wilson score lower bound of the positive-review ratio at 95% confidence (z = 1.96). It ranks a 96% game with 300 reviews sensibly against a 92% game with 80,000.
- `value = 100 * wilson - PRICE_WEIGHT * currentPriceUSD`, with `PRICE_WEIGHT = 0.75`. The intent is that a $5 game at about 89% ranks near a $20 game at about 97%. Look at the top 30, tune the weight, and record the final value in DECISIONS.md.
- **Hidden gem:** 90%+ positive, 200-5,000 reviews, $15 or less.

Caching and incremental runs. The cache is stored on the `data` branch as `cache.json`:
- Store details: refetch after 30 days. Refetch Early Access games on every `--full` run, so the switch to 1.0 gets caught.
- Reviews: refetch on every `--full` run.
- PCGamingWiki: refetch after 30 days.
- Prices: refetch on every `--prices` run.
- History: for each appid, keep `wasEa` and the date it left Early Access (`leftEaAt`). This drives the "Just Left Early Access" row.
- Save the cache to disk every 50 apps, so a run that crashes can resume where it stopped.

Rate limiting: one serial queue per host.
- Steam store: wait 1.6 s between requests. On a 429 or 403, back off for 5 minutes and retry, up to 3 times. After that, skip the app and keep its cached data.
- api.steampowered.com: 1 request per second.
- SteamSpy: 1 request per second, and 1 per 60 seconds for tag requests.
- PCGamingWiki: 1 request per second.

Write `games.json`. Keep it small: aim for under 2 MB raw. If it comes out bigger, raise the inclusion bar and log it.

```ts
type Game = {
  id: number;                 // Steam appid
  name: string;
  cap: string | null;         // portrait 600x900 library capsule URL, hotlinked
  img: string;                // landscape header image URL, hotlinked
  blurb: string;              // short description, max 160 chars
  released: string;           // ISO date
  price: { now: number; base: number; off: number; free: boolean }; // USD cents; off = discount %
  rev: { pos: number; neg: number; pct: number; wilson: number; label: string };
  coop: { online: boolean; local: boolean; lan: boolean; split: boolean; rpt: boolean }; // rpt = Remote Play Together
  players: { online: number | null; local: number | null } | null;
  gfn: { ok: boolean; optimized: boolean | null };
  ea: boolean;
  leftEaAt: string | null;
  tags: number[];             // indexes into tagNames
  value: number;
  pick: string | null;        // curated one-liner if the game is in picks.json
};
type Dataset = { generatedAt: string; tagNames: string[]; games: Game[] };
```

Also write `gfn-steam.json`, a sorted array of the Steam appids GeForce NOW supports. The checker function uses it.

## Curated picks

`data/picks.json` lives on the main branch: `[{ "appid": 0, "line": "why it's fun with friends, in one sentence", "best": "3-4 players" }]`.

To seed it, run the pipeline and take the top 40 games by value that pass the default filters. Add any of the seed titles below that qualify. Write a one-line hook for each, based on its store description: say concretely what happens when you play it together, with no hype words. I'll edit the lines afterward.

Seed titles (the pipeline decides whether they qualify; drop any that don't): Deep Rock Galactic, PlateUp!, Overcooked! 2, Unrailed!, PICO PARK, Keep Talking and Nobody Explodes, Lovers in a Dangerous Spacetime, Risk of Rain 2, Don't Starve Together, Terraria, Stardew Valley, Raft, Golf With Your Friends, Human: Fall Flat, Portal 2, Operation: Tango, Escape Simulator, Ultimate Chicken Horse, Castle Crashers, Moving Out, PEAK, Content Warning, Barony, Gunfire Reborn, We Were Here Together.

## Phase 2 - Frontend

**Default filters** (this is also what an empty URL shows):
- Max price $20 (current price, so sales count). Free games are included.
- Hide Early Access: on
- GeForce NOW only: on
- At least 85% positive and 200 reviews
- Party size: 4
- Sort: Best value

**Filters:**
- Max price slider, $0 to $60+
- Party size, 2 to 8+
- Co-op mode: online, local, split-screen, LAN
- "1 copy is enough": games with Remote Play Together and local co-op
- GeForce NOW toggle
- Early Access toggle
- Minimum % positive
- Minimum review count
- Tags (multi-select): only the ~40 most common tags in the dataset, such as Horror, Party, Puzzle, Survival, Roguelike, Shooter, Crafting and Strategy
- On sale now
- Hide MMOs (on by default)

**Party size logic:** compare against `players.online`, or against `players.local` when only local modes are selected. Games with no known player count stay visible with a "? players" badge. A "confirmed player count only" toggle (off by default) hides them.

**Sort options:** Best value, Highest rated (by wilson), Cheapest, Biggest discount, Newest, Most reviewed.

**Home page rows**, shown above the full grid: Crew Picks (curated), Hidden Gems, On Sale Now, and Just Left Early Access (last 90 days). Each is a horizontal row of cards, and each respects the current GeForce NOW, Early Access and price settings.

**Game card:**
- Portrait cover art and name
- Price: when discounted, the base price struck through plus the discount %
- Review %, review count, and Steam's label
- Chips for each co-op mode
- Player count
- Badges: GeForce NOW; "1 copy" when the game has Remote Play Together and local co-op; Early Access when EA games are shown
- Top 3 tags
- The curated line, if there is one
- "Your group of N pays $X": price times party size, or just the price for "1 copy" games

Clicking a card opens its Steam store page in a new tab. A secondary "Open in Steam" button uses `steam://store/<appid>`.

**Group features:**
- All filter state lives in the URL query string, with a "Copy link" button. The point is to send a filtered view to the group chat.
- A shortlist, saved in localStorage (wrap reads and writes in try/catch). Its "Copy for group chat" button outputs plain text, one game per line: `Name - $X - 94% positive - <steam link>`.
- A "Pick for us" button picks a random game from the current results, weighted by value score, with a reroll.

**Check a game** (search box in the top bar): paste a Steam URL or type a name, and get a verdict card right away. It shows co-op modes, Early Access yes or no, GeForce NOW yes or no, current price, review score, and max players if known. This is the "I saw it on Instagram, will it work for us?" tool.
- Look the game up in the loaded dataset first.
- If it isn't there, call the Netlify Function `check-game`. It fetches live Steam data for that appid and checks GeForce NOW support against `gfn-steam.json`.
- Give upstream calls an 8-second timeout.
- Set `Netlify-CDN-Cache-Control: public, s-maxage=21600` on responses, so repeat lookups don't rerun the function.

**Design:** follow the Design system section below exactly. The footer shows "Data updated X hours ago", says the site is not affiliated with Valve or NVIDIA, notes that prices are in USD, and credits the data sources (Steam, NVIDIA's GeForce NOW list, SteamSpy, PCGamingWiki).

**Performance:**
- Render the first 60 results, then load more on scroll.
- Lazy-load images inside fixed-ratio boxes, so the layout doesn't shift.
- Filtering the full dataset must feel instant: under 100 ms.
- Lighthouse mobile performance score of 90 or higher.

## Design system

**Use one reference: the Letterboxd iOS app.** Not a mood board. Letterboxd does our job for films: browse a large catalog by its art, filter and sort it, read a score at a glance, and share lists with friends. A small team has refined it for more than 10 years, which is the opposite of a template.

Before writing any UI, pull these screens with the Mobbin MCP. Download each screen's high-res `image_url` into `design/refs/` and commit them.

| Our screen | Reference | Mobbin |
|---|---|---|
| Home grid | Letterboxd "Popular this week" poster grid | https://mobbin.com/screens/fac7cf14-5519-47c9-9d32-f324caff474d |
| Home rows (Crew Picks, Hidden Gems, etc.) | Letterboxd list rows with poster strips | https://mobbin.com/screens/f2c54201-bdee-45ba-acf6-e948efa500d5 |
| Crew Picks editorial card | Letterboxd Year in Review card: serif title, small uppercase label | https://mobbin.com/screens/f41976a6-dc7b-47f1-b2c6-5e28640d8f77 |
| Game detail / Check a game result | Letterboxd film page: ratings histogram with a big score; solid colored stat tiles | https://mobbin.com/screens/ed3357be-d60a-40a2-9608-fa4997929f24 and https://mobbin.com/screens/fd0fae1c-e102-46f6-8f77-34f573024407 |
| Check a game search results | Letterboxd search results list | https://mobbin.com/screens/f87bd30e-5ee1-4ae7-b709-864c811e9931 |
| Shortlist | Letterboxd list page: header art, tag pills, ranked rows | https://mobbin.com/screens/edc46369-5569-47bf-971a-b0a3d3733837 and https://mobbin.com/screens/f6fb900c-adec-48b3-bd65-56b4c4ccddd1 |
| Filter sheet | Letterboxd Filters sheet: grouped rows, small uppercase section labels, the current value plus a chevron on the right, Cancel/Done in the header, Reset in an accent color | https://mobbin.com/screens/3da7e18c-df58-4f93-9e5a-18e35b753663 |
| Price filter control only | Airbnb's price histogram slider, plus its footer button with a live count ("Show 305 places" becomes "Show 214 games"). Copy how it works, not how it looks, and restyle it in our tokens. | https://mobbin.com/screens/48992aea-f113-4e2b-98e9-9de88e38e136 |
| Price display only | PlayStation App discount badge next to a struck-through base price | https://mobbin.com/screens/846e8317-4d12-4f7d-81d4-8cae06a9fc92 |

**Copy Letterboxd's system, not its identity.**
- **Take:**
  - The dark slate-blue background (not black), with lighter slate surfaces for sheets
  - Hairline dividers
  - Dense, art-first layouts
  - Bold white titles with grey-blue metadata
  - Small uppercase, letter-spaced section labels
  - A small radius on art (about 4px) with a faint 1px inner border
  - Compact segmented controls, solid colored stat tiles, and small tag pills
  - Accent color used only when it means something
- **Don't take:** the three-dot logo or anything like it, the name or wordmark, or its exact set of three accent colors. Keep the roles and how saturated they are, but choose our own hues:
  - Green = runs on GeForce NOW (it echoes NVIDIA's color, so it means something)
  - Orange = Early Access, warnings and Reset
  - Blue = "1 copy" / Remote Play Together, and information
  - Discount = a solid light badge with dark text, PlayStation-style
- **Colors:** sample the exact neutrals from the hi-res reference images. Commit them as CSS custom properties in `src/styles/tokens.css`, and document every token in `DESIGN.md`.

**Art:** Letterboxd works because posters are portrait. Use Steam's portrait library capsule (`cap`) in grids and rows. Use the landscape header (`img`) only where a wide image fits: the detail header and the Check a game result.

**Type:**
- UI text: Schibsted Grotesk. Editorial moments (Crew Picks titles, page titles): Newsreader. Both are on Google Fonts. Self-host them, subset them, and use `font-display: swap`.
- Prices, percentages and counts use tabular figures (`font-variant-numeric: tabular-nums`). Check that Schibsted Grotesk supports them. If it doesn't, switch to a grotesk that does and log it in DECISIONS.md.
- One 6-step type scale and a 4px spacing grid. No other fonts.

**Banned. Any one of these fails review:**
- Inter, Geist, Roboto, Space Grotesk, Satoshi, Manrope, Fraunces or Bricolage as visible fonts
- Purple, indigo or violet anywhere; gradient text; mesh, blob or aurora backgrounds; glassmorphism; neon glow
- Near-black with one acid-green accent, or cream with terracotta. These are the usual "make it look less AI" defaults.
- A centered hero with a tagline and a call-to-action button; a row of three feature cards; "Discover your next favorite game" style copy; sparkle icons; emoji used as icons
- The same rounded-2xl card with a soft drop shadow everywhere; untouched shadcn or Tailwind defaults; pill badges on everything
- Made-up stats, testimonials or placeholder names
- Em dashes in copy

**Desktop:** the reference is a phone app, so widen the same system without new components. The poster grid goes to 6-8 columns, the filter sheet becomes a left rail with the same grouped rows, and the detail view opens as a side sheet. Same tokens throughout.

## Phase 3 - GitHub Actions and deploy

`.github/workflows/refresh-data.yml`:
- Schedule: a full refresh weekly (Mondays at 08:17 UTC) and a price refresh daily (18:23 UTC, since Steam sales roll over around 10am Pacific). Add `workflow_dispatch` with a mode input.
- Steps: check out main for the code, and the `data` branch into `.data/`. Run the pipeline. Commit and push `data` only if something changed. Then purge `https://purge.jsdelivr.net/gh/<owner>/<repo>@data/games.json` and `gfn-steam.json`.
- Settings: `timeout-minutes: 300`, a `concurrency` group so two refreshes never overlap, `permissions: contents: write`, and an optional `STEAM_API_KEY` secret.

`netlify.toml`: build command `npm run build`, publish directory `dist`, functions directory `netlify/functions`, Node 22.

`README.md`: exact steps for me:
1. Create a public GitHub repo and push the code.
2. Connect the repo to Netlify (or run `netlify init`).
3. Add the Steam API key secret, if Phase 0 showed one is needed.
4. Run the workflow once by hand.
5. Confirm the site loads live data.

If the `gh` and `netlify` CLIs are installed and logged in, do these steps yourself and tell me what you did.

## Phase 4 - Verify before you tell me it's done

1. Report the funnel numbers from a full run, and the size of games.json raw and gzipped.
2. Take 5 games from the output and check every field on their cards against the live Steam store page and GeForce NOW's game search. Fix any mismatch where the data comes in, not in the UI.
3. Find 3 co-op games that are in Early Access on Steam right now. Confirm they're hidden by default, and that the toggle shows them with a badge.
4. Find 2 co-op games that aren't on GeForce NOW. Confirm the GeForce NOW filter hides them.
5. Confirm Check a game works for a Steam URL, a typed name, a game that isn't in the dataset, and a game with no co-op (which should get a plain "no co-op" answer).
6. Open a copied filter URL in a fresh browser and confirm it shows the same results.
7. Run Lighthouse on mobile and report the numbers.
8. Run the scheduled workflow once by hand, confirm it succeeds, and check that the live site shows the new `generatedAt`.
9. Design review:
   - Take 375px-wide screenshots of our home grid, filter sheet, game detail and shortlist.
   - In `design/review.md`, put each one next to its reference screen and list every place we differ, with the reason.
   - Then check the built CSS and the site copy against the banned list: grep for the banned font names, purple, indigo and violet hues, and em dashes. Fix every hit.

Finish with a short summary: what's live, the URL, the main points in DECISIONS.md, and anything that didn't work.

## Later (not in v1)

- **Crew library check:** enter friends' Steam profile URLs and see "3 of 4 already own this", plus a list of games everyone owns that pass the filters. This needs a Steam Web API key in a Netlify env var and public game details on each profile (`GetOwnedGames`). Build it only after v1 is live and I ask for it.
