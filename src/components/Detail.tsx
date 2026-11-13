import type { Game } from '@shared/types';
import { compact, groupCost, longDate, modeChips, oneCopy, playersLabel, usd, usdShort } from '../lib/format';
import { steamAppUrl, steamStoreUrl } from '../lib/data';
import { Art } from './Card';
import { Icon } from './icons';

type Props = {
  game: Game;
  party: number;
  tagNames: string[];
  saved: boolean;
  onToggleSave: (g: Game) => void;
};

export function Detail({ game: g, party, tagNames, saved, onToggleSave }: Props) {
  const total = g.rev.pos + g.rev.neg;
  const posShare = total ? (100 * g.rev.pos) / total : 0;
  const players = playersLabel(g);
  const cost = groupCost(g, party);
  const one = oneCopy(g);
  const modes = modeChips(g);
  return (
    <div>
      <div class="detail-hero">
        <Art game={g} wide eager />
        <div class="fade" />
      </div>
      <div class="detail-body">
        <h2 class="detail-title">{g.name}</h2>
        <div class="detail-sub num">
          {g.released ? `Released ${longDate(g.released)}` : ''}
          {g.leftEaAt && !g.ea ? ` · Left Early Access ${longDate(g.leftEaAt)}` : ''}
        </div>

        <div class="score num">
          <div class="big">{g.rev.pct}%</div>
          <div class="lbl">
            <b>{g.rev.label}</b>
            {total.toLocaleString()} Steam reviews
          </div>
        </div>
        <div class="ratio" aria-hidden="true">
          <i class="pos" style={{ width: `${posShare}%` }} />
          <i class="neg" style={{ width: `${100 - posShare}%` }} />
        </div>
        <div class="ratio-legend num">
          <span>{compact(g.rev.pos)} positive</span>
          <span>{compact(g.rev.neg)} negative</span>
        </div>

        <div class="tiles">
          <div class={`tile ${g.gfn.ok ? 'yes' : 'no'}`}>
            <span class="k">GeForce NOW</span>
            <span class="v">{g.gfn.ok ? 'Yes' : 'No'}</span>
          </div>
          <div class={`tile ${g.ea ? 'warn' : 'no'}`}>
            <span class="k">Early Access</span>
            <span class="v">{g.ea ? 'Yes' : 'No'}</span>
          </div>
          <div class={`tile ${one ? 'info' : 'no'}`}>
            <span class="k">Copies needed</span>
            <span class="v">{one ? '1' : g.price.free ? '0' : party >= 8 ? '8+' : party}</span>
          </div>
          <div class="tile num">
            <span class="k">Price</span>
            <span class="v">
              {usd(g.price.now)}
              {g.price.off > 0 ? <small> -{g.price.off}%</small> : null}
            </span>
          </div>
          <div class="tile num">
            <span class="k">Max players</span>
            <span class="v">{g.players?.online ?? g.players?.local ?? '?'}</span>
          </div>
          <div class="tile num">
            <span class="k">Value score</span>
            <span class="v">{g.value.toFixed(0)}</span>
          </div>
        </div>

        <div class="detail-group num">
          <div>
            <b>{g.price.free ? 'Free for everyone' : one ? `${usdShort(cost.cents)} for the whole group` : `${usdShort(cost.cents)} for ${party >= 8 ? '8' : party} copies`}</b>
            <div class="sub">
              {one ? 'Remote Play Together: one person owns it, the rest join their screen' : g.price.free ? 'Free to play on Steam' : `${usd(g.price.now)} each`}
            </div>
          </div>
        </div>

        <div class="detail-section">
          <span class="label">Co-op modes</span>
          <div class="chips">
            {modes.map((m) => (
              <span class="chip on" key={m}>
                {m}
              </span>
            ))}
            <span class={`chip ${players.known ? '' : ''}`}>{players.text}</span>
          </div>
        </div>

        {g.pick ? (
          <div class="detail-section">
            <span class="label">Crew pick{g.best ? ` · best with ${g.best}` : ''}</span>
            <p class="pickline">{g.pick}</p>
          </div>
        ) : null}

        <div class="detail-section">
          <span class="label">About</span>
          <p>{g.blurb}</p>
        </div>

        {g.tags.length ? (
          <div class="detail-section">
            <span class="label">Tags</span>
            <div class="tagwrap">
              {g.tags.map((i) => (
                <span class="tagpill" key={i}>
                  {tagNames[i]}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div class="btnrow">
          <a class="btn primary" href={steamStoreUrl(g.id)} target="_blank" rel="noopener">
            <Icon.External /> Steam store page
          </a>
          <a class="btn" href={steamAppUrl(g.id)}>
            Open in Steam
          </a>
          <button class={`btn ${saved ? '' : 'info'}`} onClick={() => onToggleSave(g)}>
            {saved ? <Icon.Check /> : <Icon.Plus />}
            {saved ? 'On your shortlist' : 'Add to shortlist'}
          </button>
        </div>
      </div>
    </div>
  );
}
