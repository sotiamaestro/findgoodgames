import type { Game } from '@shared/types';
import { compact, groupCost, modeChips, oneCopy, playersLabel, usd, usdShort } from '../lib/format';
import { steamStoreUrl } from '../lib/data';
import { Icon } from './icons';

type ArtProps = { game: Game; eager?: boolean; wide?: boolean; children?: preact.ComponentChildren };

/** Fixed-ratio art box: portrait capsule, or the header image center-cropped when there is none. */
export function Art({ game, eager = false, wide = false, children }: ArtProps) {
  const src = wide ? game.img : game.cap ?? game.img;
  return (
    <div class={`art ${wide ? 'wide' : ''}`}>
      <img
        src={src}
        alt=""
        width={wide ? 460 : 600}
        height={wide ? 215 : 900}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        fetchpriority={eager ? 'high' : 'auto'}
        onError={(e) => {
          const el = e.currentTarget as HTMLImageElement;
          if (el.src !== game.img) el.src = game.img;
        }}
      />
      {children}
    </div>
  );
}

type CardProps = {
  game: Game;
  party: number;
  preferLocal: boolean;
  saved: boolean;
  showEa: boolean;
  eager?: boolean;
  tagNames: string[];
  onOpen: (g: Game) => void;
  onToggleSave: (g: Game) => void;
};

export function GameCard({ game: g, party, preferLocal, saved, showEa, eager, tagNames, onOpen, onToggleSave }: CardProps) {
  const chips = modeChips(g);
  const players = playersLabel(g, preferLocal);
  const cost = groupCost(g, party);
  const one = oneCopy(g);
  return (
    <article class="card">
      <a
        href={steamStoreUrl(g.id)}
        target="_blank"
        rel="noopener"
        onClick={(e) => {
          // Plain click opens the detail sheet; modifier clicks keep the native new-tab behaviour.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
          e.preventDefault();
          onOpen(g);
        }}
        aria-label={`${g.name}, ${g.rev.pct}% positive, ${usd(g.price.now)}`}
      >
        <Art game={g} eager={eager}>
          {showEa && g.ea ? (
            <div class="corner">
              <span class="badge ea">Early Access</span>
            </div>
          ) : null}
        </Art>
      </a>
      <button class={`save ${saved ? 'on' : ''}`} onClick={() => onToggleSave(g)} aria-label={saved ? 'Remove from shortlist' : 'Add to shortlist'} aria-pressed={saved}>
        {saved ? <Icon.Check /> : <Icon.Plus />}
      </button>
      <div class="name">{g.name}</div>
      <div class="price num">
        {g.price.free ? <span class="free">Free</span> : <span>{usd(g.price.now)}</span>}
        {g.price.off > 0 ? (
          <>
            <s>{usd(g.price.base)}</s>
            <span class="badge off">-{g.price.off}%</span>
          </>
        ) : null}
      </div>
      <div class="reviews num">
        <b>{g.rev.pct}%</b>
        <span>{compact(g.rev.pos + g.rev.neg)}</span>
        <span>{g.rev.label}</span>
      </div>
      <div class="chips">
        {chips.map((c) => (
          <span class="chip" key={c}>
            {c}
          </span>
        ))}
      </div>
      <div class="meta">
        <span class={`players num ${players.known ? '' : 'unknown'}`}>{players.text}</span>
        {g.gfn.ok ? <span class="badge gfn">GeForce NOW</span> : null}
        {one ? <span class="badge copy">1 copy</span> : null}
      </div>
      {g.tags.length ? <div class="tags">{g.tags.slice(0, 3).map((i) => tagNames[i]).filter(Boolean).join(' · ')}</div> : null}
      {g.pick ? <div class="pickline">{g.pick}</div> : null}
      <div class="group num">
        {g.price.free ? (
          <span>Your group pays nothing</span>
        ) : one ? (
          <span>
            Your group pays <b>{usdShort(cost.cents)}</b> for 1 copy
          </span>
        ) : (
          <span>
            Your group of {party >= 8 ? '8' : party} pays <b>{usdShort(cost.cents)}</b>
          </span>
        )}
      </div>
    </article>
  );
}

type PosterProps = { game: Game; rank?: number; onOpen: (g: Game) => void; showEa: boolean };

/** Poster-only card for horizontal rows. */
export function PosterCard({ game: g, rank, onOpen, showEa }: PosterProps) {
  return (
    <button class="poster-card" onClick={() => onOpen(g)} aria-label={`${g.name}, ${g.rev.pct}% positive, ${usd(g.price.now)}`}>
      <Art game={g}>
        {rank ? <span class="rank num">{rank}</span> : null}
        {showEa && g.ea ? (
          <div class="corner">
            <span class="badge ea">EA</span>
          </div>
        ) : null}
      </Art>
      <div class="name">{g.name}</div>
      <div class="meta num">
        <span class="pct">{g.rev.pct}%</span>
        <span>{usdShort(g.price.now)}</span>
        {g.price.off > 0 ? <span class="badge off">-{g.price.off}%</span> : null}
      </div>
    </button>
  );
}
