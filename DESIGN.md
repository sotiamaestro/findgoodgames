# DESIGN.md

One reference: the Letterboxd iOS app, as captured in `design/refs/` (pulled from Mobbin, 1179x2676 px). We copy its system (dark slate-blue surfaces, hairlines, art-first density, bold white titles with grey-blue metadata, small uppercase labels, 4px art radius with a faint inner border, compact segmented controls, solid stat tiles, small tag pills) and not its identity (no three-dot mark, no wordmark, different accent hues).

## Reference screens

| Our screen | File in design/refs | Mobbin id |
|---|---|---|
| Home grid | home-grid__fac7cf14.jpg | fac7cf14 |
| Home rows | home-rows-poster-strips__f2c54201.jpg | f2c54201 |
| Crew Picks editorial card | crew-picks-editorial-card__f41976a6.jpg | f41976a6 |
| Game detail (score + histogram) | detail-ratings-histogram__fd0fae1c.jpg | fd0fae1c |
| Game detail (stat tiles) | detail-stat-tiles__ed3357be.jpg | ed3357be |
| Check a game results | search-results__f87bd30e.jpg | f87bd30e |
| Shortlist (list page) | shortlist-list-page__edc46369.jpg | edc46369 |
| Shortlist (ranked rows) | shortlist-ranked-rows__f6fb900c.jpg | f6fb900c |
| Filter sheet | filter-sheet__3da7e18c.jpg | 3da7e18c |
| Price control (behaviour only) | price-histogram-slider__airbnb-48992aea.jpg | 48992aea (Airbnb) |
| Discount badge (display only) | discount-badge__psapp-846e8317.jpg | 846e8317 (PlayStation App) |

## Tokens (src/styles/tokens.css)

Neutrals were sampled from the hi-res reference JPEGs with Pillow (dominant colour of a region, or the brightest 2% of pixels for text). JPEG quantisation means values are exact to the image, not to Letterboxd's source CSS.

| Token | Value | Sampled from | Used for |
|---|---|---|---|
| `--bg` | `#14181c` | left margin of the film page and the list page | page background |
| `--bg-band` | `#181820` | home grid background between posters | reserved for grid bands |
| `--raised` | `#283038` | the Cast / Crew tab strip on the film page | inputs, chips, raised rows, tiles with no state |
| `--surface` | `#445464` | filter sheet background, bottom tab bar | sheet background, selected segments on the rail |
| `--surface-2` | `#647484` | segmented control track on the home grid | selected segment on the sheet, histogram bars |
| `--pill` | `#485464` | "imdb / top 250 / watchlist" pills on the list page | tag pills |
| `--line` | `#3a4048` | row dividers on the search results screen | hairlines on the page |
| `--line-surface` | `#203242` | row dividers on the filter sheet | hairlines on the sheet |
| `--art-border` | `rgba(255,255,255,0.08)` | poster edges on the home grid read as a faint light rim | 1px inner border on art |
| `--text` | `#ffffff` | "Popular this week", film titles | titles, values |
| `--text-2` | `#9eafbf` | section label on the filter sheet; row subtitles on the lists tab read `#aebac5` | metadata |
| `--text-3` | `#5c6d7d` | "RATINGS" label on the film page; list meta reads `#606b76` | muted labels |
| `--text-surface` | `#c2d3e3` | "Sort by" row label on the sheet | row labels on the sheet |
| `--text-surface-2` | `#a0b1c1` | "Member popularity" value on the sheet | row values on the sheet |

Accents keep the reference's roles and saturation but use our own hues. Letterboxd's green / blue / orange are not reused.

| Token | Value | Role |
|---|---|---|
| `--gfn` / `--gfn-ink` | `#76b900` / `#0f1a06` | runs on GeForce NOW (echoes NVIDIA's green); positive share of the ratings bar; "Done" and switch-on states |
| `--warn` / `--warn-ink` | `#ff9640` / `#2a1200` | Early Access, warnings, Reset |
| `--info` / `--info-ink` | `#3d8ee8` / `#ffffff` | "1 copy" / Remote Play Together, information, the shortlist save state |
| `--badge` / `--badge-ink` | `#e8edf2` / `#14181c` | discount badge: solid light with dark text, PlayStation App style |
| `--neg` | `#c94f4f` | negative share of the ratings bar only |

Purple, indigo and violet do not appear anywhere. No gradients on text, no glass, no glow. The only gradient is the solid-to-transparent fade under a hero image, which the reference also uses.

## Type

- UI: Schibsted Grotesk, variable 400-900, self-hosted Latin subset (`public/fonts/schibsted-grotesk-latin.woff2`, 48 KB), `font-display: swap`. It ships `tnum`, so prices, percentages and counts use `font-variant-numeric: tabular-nums` through the `.num` class.
- Editorial: Newsreader, variable wght 400-700 and opsz 18-72, Latin subset (`public/fonts/newsreader-latin.woff2`, 73 KB). Used for the brand, Crew Picks titles, the detail title, the shortlist title, and the curated one-liners.
- Scale (6 steps): `--t1` 11, `--t2` 13, `--t3` 15, `--t4` 17, `--t5` 22, `--t6` 28 px. One exception: the detail page score is 44px, mirroring the reference's oversized rating.
- Section labels: `--t1`, 700, uppercase, 0.08em tracking (`.label`).

## Spacing and shape

- 4px grid: `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s5` 24, `--s6` 32.
- Art radius 4px with a 1px inner border (`.art`). Controls 6px. Stat tiles 8px. Tag pills are the only fully rounded element, as in the reference.
- Hairline dividers everywhere a row ends; no drop shadows.

## Components and their reference

- Home grid: poster grid (2 columns on phones, up to 8 on wide screens), each poster followed by dense metadata. The reference shows posters only; our cards carry the facts the brief requires, so text sits under the art at `--t1`/`--t2` sizes rather than on it.
- Rows: horizontal poster strips under an uppercase label and a title, like the lists tab. Crew Picks uses the editorial serif title.
- Detail / Check a game: big score with a positive/negative ratio bar in place of the star histogram (we have two buckets, not five), then solid stat tiles (green = yes on GeForce NOW, orange = Early Access, blue = one copy is enough), then chips, text, tags and actions.
- Check a game results: avatar-sized poster, bold title, grey metadata, chevron, hairlines, like the search results screen.
- Shortlist: hero art with a fade, serif title, tag pills, ranked rows with a numbered badge on the poster, like the list page.
- Filter sheet: Cancel / Filters / Done header, grouped rows with uppercase section labels, value plus chevron on the right, inline switches, orange Reset, and an Airbnb-style footer button with the live count. On desktop the same rows live in a left rail.
- Price control: histogram of the current results by price with a single max-price thumb; the Airbnb behaviour restyled in our tokens.
- Discount: `-38%` as a solid light badge beside the struck-through base price, PlayStation App style.
