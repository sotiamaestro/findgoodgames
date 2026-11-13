import { useEffect, useState } from 'preact/hooks';
import type { CheckResult, Game } from '@shared/types';
import { fromDataset, liveCheck, liveSearch, parseAppId, searchDataset, type LiveMatch } from '../lib/check';
import { compact, longDate, usd } from '../lib/format';
import { steamStoreUrl } from '../lib/data';
import { Art } from './Card';
import { Icon } from './icons';

type Props = {
  query: string;
  games: Game[];
  byId: Map<number, Game>;
  onOpenGame: (g: Game) => void;
};

type State =
  | { kind: 'idle' }
  | { kind: 'loading'; what: string }
  | { kind: 'results'; local: Game[]; live: LiveMatch[] | null; liveError: string | null }
  | { kind: 'verdict'; result: CheckResult; game: Game | null }
  | { kind: 'error'; message: string };

function modeList(c: CheckResult['coop']): string[] {
  const out: string[] = [];
  if (c.online) out.push('Online co-op');
  if (c.local) out.push(c.split ? 'Split screen' : 'Local co-op');
  if (c.lan) out.push('LAN co-op');
  if (c.rpt) out.push('Remote Play Together');
  return out;
}

export function CheckGame({ query, games, byId, onOpenGame }: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  const showVerdict = async (appid: number) => {
    const g = byId.get(appid);
    if (g) {
      setState({ kind: 'verdict', result: fromDataset(g), game: g });
      return;
    }
    setState({ kind: 'loading', what: 'Asking Steam and GeForce NOW...' });
    try {
      const result = await liveCheck(appid);
      setState({ kind: 'verdict', result, game: null });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Lookup failed' });
    }
  };

  const searchLive = async (q: string, local: Game[]) => {
    setState({ kind: 'loading', what: `Searching Steam for "${q}"...` });
    try {
      const live = await liveSearch(q);
      setState({ kind: 'results', local, live, liveError: null });
    } catch (err) {
      setState({ kind: 'results', local, live: [], liveError: err instanceof Error ? err.message : 'Steam search failed' });
    }
  };

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setState({ kind: 'idle' });
      return;
    }
    const appid = parseAppId(q);
    if (appid) {
      void showVerdict(appid);
      return;
    }
    const local = searchDataset(games, q);
    if (local.length === 1 && local[0]!.name.toLowerCase() === q.toLowerCase()) {
      setState({ kind: 'verdict', result: fromDataset(local[0]!), game: local[0]! });
    } else if (local.length) {
      setState({ kind: 'results', local, live: null, liveError: null });
    } else {
      void searchLive(q, local);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, games]);

  if (state.kind === 'idle') {
    return <div class="notice">Paste a Steam store link or type a game name.</div>;
  }
  if (state.kind === 'loading') {
    return <div class="notice">{state.what}</div>;
  }
  if (state.kind === 'error') {
    return <div class="notice err">{state.message}</div>;
  }
  if (state.kind === 'results') {
    return (
      <div class="check-results">
        {state.local.length ? <div class="notice">In our dataset</div> : null}
        {state.local.map((g) => (
          <button key={g.id} class="check-row" onClick={() => setState({ kind: 'verdict', result: fromDataset(g), game: g })}>
            <div class="thumb">
              <Art game={g} />
            </div>
            <div class="t">
              <b>{g.name}</b>
              <span class="num">
                {g.released.slice(0, 4)} · {g.rev.pct}% · {usd(g.price.now)}
              </span>
            </div>
            <Icon.Chevron />
          </button>
        ))}
        {state.live === null ? (
          <button class="check-row more" onClick={() => void searchLive(query, state.local)}>
            <Icon.Search />
            <div class="t">
              <b>Not it? Search all of Steam for "{query}"</b>
              <span>Live lookup, a few seconds</span>
            </div>
          </button>
        ) : (
          <>
            <div class="notice">{state.live.length ? 'On Steam' : state.liveError ?? `Nothing on Steam matches "${query}".`}</div>
            {state.live.map((m) => (
              <button key={m.id} class="check-row" onClick={() => void showVerdict(m.id)}>
                <div class="thumb">
                  <div class="art">{m.img ? <img src={m.img} alt="" loading="lazy" decoding="async" width={600} height={900} /> : null}</div>
                </div>
                <div class="t">
                  <b>{m.name}</b>
                  <span>Steam app {m.id}</span>
                </div>
                <Icon.Chevron />
              </button>
            ))}
          </>
        )}
      </div>
    );
  }

  const r = state.result;
  const modes = modeList(r.coop);
  const concerns: string[] = [];
  if (r.anyCoop) {
    if (r.ea) concerns.push('still in Early Access');
    if (!r.gfn) concerns.push('not on GeForce NOW');
    if (r.comingSoon) concerns.push('not released yet');
    if (r.adult) concerns.push('adult content');
  }
  const headline = !r.anyCoop ? 'No co-op' : concerns.length ? `Co-op, but ${concerns.join(' and ')}` : 'Good to go';
  const fakeGame: Game | null = state.game;
  return (
    <div class="verdict">
      <div class="art wide">{r.img ? <img src={r.img} alt="" width={460} height={215} loading="eager" decoding="async" /> : null}</div>
      <h3 class={`headline ${!r.anyCoop || concerns.length ? 'bad' : ''}`}>{headline}</h3>
      <div class="sub">
        {r.name}
        {r.released ? ` · ${longDate(r.released)}` : ''}
        {r.source === 'live' ? ' · live from Steam' : ''}
      </div>
      {!r.anyCoop ? <p class="notice" style={{ padding: 0, marginBottom: '16px' }}>Steam lists no co-op category for this game, so it will not work for your group as a co-op night.</p> : null}
      <div class="tiles">
        <div class={`tile ${r.anyCoop ? 'yes' : 'no'}`}>
          <span class="k">Co-op</span>
          <span class={`v ${modes.length > 1 ? 'small' : ''}`}>{r.anyCoop ? modes.join(', ') : 'None'}</span>
        </div>
        <div class={`tile ${r.ea ? 'warn' : 'no'}`}>
          <span class="k">Early Access</span>
          <span class="v">{r.ea ? 'Yes' : 'No'}</span>
        </div>
        <div class={`tile ${r.gfn ? 'yes' : 'no'}`}>
          <span class="k">GeForce NOW</span>
          <span class="v">{r.gfn ? 'Yes' : 'No'}</span>
        </div>
        <div class="tile num">
          <span class="k">Price</span>
          <span class="v">
            {r.price ? usd(r.price.now) : r.comingSoon ? 'TBA' : '?'}
            {r.price && r.price.off > 0 ? <small> -{r.price.off}%</small> : null}
          </span>
        </div>
        <div class="tile num">
          <span class="k">Reviews</span>
          <span class="v">
            {r.rev && r.rev.count > 0 ? `${r.rev.pct}%` : 'None'}
            {r.rev && r.rev.count > 0 ? <small> {compact(r.rev.count)}</small> : null}
          </span>
        </div>
        <div class="tile num">
          <span class="k">Max players</span>
          <span class="v">{fakeGame?.players?.online ?? fakeGame?.players?.local ?? '?'}</span>
        </div>
      </div>
      {r.blurb ? <p class="notice" style={{ padding: 0 }}>{r.blurb}</p> : null}
      <div class="btnrow" style={{ marginTop: '16px' }}>
        <a class="btn primary" href={steamStoreUrl(r.id)} target="_blank" rel="noopener">
          <Icon.External /> Steam store page
        </a>
        {fakeGame ? (
          <button class="btn" onClick={() => onOpenGame(fakeGame)}>
            Full details
          </button>
        ) : null}
      </div>
    </div>
  );
}
