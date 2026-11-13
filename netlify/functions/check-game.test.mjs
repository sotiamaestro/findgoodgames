// Calls the check-game function handler directly (no Netlify dev server needed).
// Each case is one or two live Steam requests, so run it when nothing else is
// talking to Steam.
//
//   npx tsx netlify/functions/check-game.test.mjs

import handler from './check-game.mts';

const cases = [
  ['Portal 2 by appid (co-op, released)', '?appid=620'],
  ['Cyberpunk 2077 by appid (single-player)', '?appid=1091500'],
  ['Lethal Company by appid (Early Access)', '?appid=1966720'],
  ['name search "overcooked"', '?q=overcooked'],
  ['missing app', '?appid=999999999'],
  ['no params', ''],
];

for (const [label, qs] of cases) {
  const started = Date.now();
  const res = await handler(new Request(`http://localhost/api/check-game${qs}`), {});
  const body = await res.json();
  const ms = Date.now() - started;
  const summary =
    'matches' in body
      ? `${body.matches.length} matches: ${body.matches.map((m) => `${m.id} ${m.name}`).slice(0, 3).join('; ')}`
      : body.error
        ? `error: ${body.error}`
        : `${body.name} | type ${body.type} | coop ${body.anyCoop ? Object.entries(body.coop).filter(([, v]) => v).map(([k]) => k).join(',') : 'none'} | ea ${body.ea} | gfn ${body.gfn} | price ${body.price ? body.price.now : 'n/a'} | rev ${body.rev ? `${body.rev.pct}% of ${body.rev.count}` : 'n/a'}${body.gfnListUnavailable ? ' | GFN LIST UNAVAILABLE' : ''}`;
  console.log(`${res.status} ${String(ms).padStart(5)}ms  ${label}\n      ${summary}\n      cache: ${res.headers.get('Netlify-CDN-Cache-Control')}`);
}
