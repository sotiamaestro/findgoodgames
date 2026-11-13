# Co-op Finder

One question, answered fast: what should our group buy and play tonight?

A static site (Vite + Preact + TypeScript) that lists Steam co-op games which are fully released, cheap, well reviewed and playable on GeForce NOW, ranked by value. All facts come from a scheduled data pipeline (GitHub Actions); the only hand-written text is the one-line Crew Picks blurbs in `data/picks.json`.

- `PROMPT.md` - the brief this was built from.
- `pipeline/PROBE.md` - what every data source actually returns (Phase 0).
- `DECISIONS.md` - every call made along the way and why.
- `DESIGN.md` - tokens and the Letterboxd reference mapping.
- `design/review.md` - screenshots next to the reference screens.

## How it fits together

```
GitHub Actions (weekly full, daily prices)
  pipeline/build-data.ts  ->  commits games.json, gfn-steam.json, cache.json to the orphan `data` branch
                          ->  purges jsDelivr

Netlify (deploys only when main changes)
  dist/                   <-  npm run build
  /api/check-game         <-  netlify/functions/check-game.mts (live Steam lookup for games outside the dataset)

Browser
  games.json              <-  cdn.jsdelivr.net/gh/<owner>/<repo>@data/games.json
                              then raw.githubusercontent.com, then /data/games.fallback.json
```

## Setting it up (exact steps)

1. **Create a public GitHub repo and push the code.** The repo must be public because jsDelivr and raw.githubusercontent.com serve the data branch anonymously.

   ```bash
   gh repo create <owner>/<repo> --public --source=. --push
   ```

   This repository was created as `sotiamaestro/findgoodgames`; if you fork or rename it, change `DATA_REPO` in `shared/config.ts` and the jsDelivr URLs will follow.

2. **Connect the repo to Netlify.** Either in the Netlify UI (Add new site > Import an existing project > GitHub > pick the repo; the build command `npm run build`, publish directory `dist` and functions directory `netlify/functions` are read from `netlify.toml`), or from the terminal:

   ```bash
   npx netlify-cli login
   ```

   ```bash
   npx netlify-cli init
   ```

   Netlify only rebuilds when `main` changes. Data refreshes land on the `data` branch and never trigger a deploy, so they cost no build credits.

3. **Steam API key secret.** Not needed. Phase 0 confirmed every Steam endpoint used works without a key (see `pipeline/PROBE.md`). If Valve ever starts requiring one, add a repository secret named `STEAM_API_KEY`; the pipeline passes it through automatically.

4. **Run the workflow once by hand.**

   ```bash
   gh workflow run refresh-data.yml -f mode=full
   ```

   The first full run takes about 1.5 hours (one review request per game, one PCGamingWiki request per game). Later weekly runs reuse the PCGamingWiki cache; daily price runs take a few minutes. Watch it with:

   ```bash
   gh run watch
   ```

5. **Confirm the site loads live data.** Open the site; the footer says "Data updated X hours ago". Open `https://cdn.jsdelivr.net/gh/<owner>/<repo>@data/games.json` and compare `generatedAt`. If the footer says it is showing the bundled snapshot, the data branch is missing or the repo is private.

## Local development

```bash
npm install
```

```bash
npm run data -- --limit 300
```

That writes a small `.data/games.json`. Copy it to `public/data/games.fallback.json` if you want the dev server to show it without a data branch, then:

```bash
npm run dev
```

Other pipeline modes:

```bash
npm run data:full
```

```bash
npm run data:prices
```

Add `--fallback` to any run to refresh `public/data/games.fallback.json` (the snapshot bundled with the site), and `--verbose` to log every request.

Bootstrapping the `data` branch by hand (only needed before the first workflow run, or to replace it):

```bash
sh scripts/bootstrap-data-branch.sh
```

## Verification scripts

All of these run against a local production build (`npm run build` then `npx vite preview --port 4173`) and the Chrome installed on the machine:

```bash
node design/verify-url.mjs
```

```bash
node design/verify-filters.mjs http://localhost:4173 "Phasmophobia" "R.E.P.O." "Schedule I" -- "WEBFISHING" "Hidden in Plain Sight"
```

```bash
node design/screenshot.mjs
```

```bash
sh design/banned-check.sh
```

```bash
npx tsx scripts/check-game.test.mjs
```

The first checks that a copied filter URL reproduces the same results in a fresh browser; the second that Early Access and non GeForce NOW games are hidden by default and shown with the toggles; the third writes the 375px screenshots used in `design/review.md`; the fourth greps the build and copy for the brief's banned list; the last calls the Netlify function handler directly against live Steam.

## Curated picks

`data/picks.json` is the only hand-written content: `[{ "appid": 620, "line": "one sentence", "best": "2 players" }]`. The pipeline attaches `line` to the matching game as `pick` and `best` as `best`; games listed here are always fetched even when SteamSpy and the tag query miss them, but they still have to pass the same inclusion rules.

To re-seed the file from a fresh build (top 40 by value plus the brief's seed titles that qualify), keeping any lines already written:

```bash
npx tsx pipeline/seed-picks.ts --merge
```

## Credits

Store data, categories and review counts from Steam. GeForce NOW support from NVIDIA's public catalog API. Candidate seeds from SteamSpy. Player counts from PCGamingWiki (CC BY-NC-SA 3.0). Not affiliated with Valve or NVIDIA.
