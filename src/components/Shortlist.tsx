import type { Game } from '@shared/types';
import { compact, groupCost, modeChips, usd, usdShort } from '../lib/format';
import { Art } from './Card';
import { Icon } from './icons';

type Props = {
  games: Game[];
  party: number;
  onOpen: (g: Game) => void;
  onRemove: (g: Game) => void;
  onCopy: () => void;
  onClear: () => void;
  onBack: () => void;
};

export function Shortlist({ games, party, onOpen, onRemove, onCopy, onClear, onBack }: Props) {
  const total = games.reduce((sum, g) => sum + groupCost(g, party).cents, 0);
  const modes = new Set(games.flatMap(modeChips));
  const hero = games[0];
  return (
    <section aria-label="Shortlist">
      {hero ? (
        <div class="list-hero">
          <Art game={hero} wide eager />
          <div class="fade" />
        </div>
      ) : null}
      <div class="list-head">
        <span class="label">Shortlist</span>
        <h1>Tonight's options</h1>
        <div class="sub num">
          {games.length} game{games.length === 1 ? '' : 's'}
          {games.length ? ` · ${usdShort(total)} for the group of ${party >= 8 ? '8' : party} if you bought them all` : ''}
        </div>
        {modes.size ? (
          <div class="tagwrap">
            {[...modes].map((m) => (
              <span class="tagpill" key={m}>
                {m}
              </span>
            ))}
          </div>
        ) : null}
        <div class="btnrow">
          <button class="btn primary" onClick={onCopy} disabled={!games.length}>
            <Icon.Link /> Copy for group chat
          </button>
          <button class="btn" onClick={onBack}>
            Back to games
          </button>
          {games.length ? (
            <button class="btn" onClick={onClear}>
              Clear
            </button>
          ) : null}
        </div>
      </div>
      {games.length ? (
        <ol class="ranked">
          {games.map((g, i) => (
            <li key={g.id}>
              <button class="thumb" onClick={() => onOpen(g)} aria-label={g.name}>
                <Art game={g}>
                  <span class="rank num">{i + 1}</span>
                </Art>
              </button>
              <div class="t">
                <div class="n">
                  <button onClick={() => onOpen(g)}>{g.name}</button>
                  <span class="num">{g.released.slice(0, 4)}</span>
                </div>
                <div class="m num">
                  {usd(g.price.now)}
                  {g.price.off > 0 ? ` (-${g.price.off}%)` : ''} · {g.rev.pct}% of {compact(g.rev.pos + g.rev.neg)} · {modeChips(g).join(', ')}
                  {g.gfn.ok ? ' · GeForce NOW' : ''}
                </div>
              </div>
              <button class="rm" onClick={() => onRemove(g)} aria-label={`Remove ${g.name}`}>
                Remove
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div class="empty">
          <b>Your shortlist is empty</b>
          Tap the plus on any game to save it here, then copy the list into the group chat.
        </div>
      )}
    </section>
  );
}
