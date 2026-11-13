import type { Game } from '@shared/types';
import { compact, groupCost, modeChips, usd, usdShort } from '../lib/format';
import { steamStoreUrl } from '../lib/data';
import { Art } from './Card';
import { Icon } from './icons';

type Props = {
  game: Game | null;
  party: number;
  saved: boolean;
  onReroll: () => void;
  onOpen: (g: Game) => void;
  onToggleSave: (g: Game) => void;
};

export function PickForUs({ game: g, party, saved, onReroll, onOpen, onToggleSave }: Props) {
  if (!g) return <div class="notice">Nothing to pick from. Loosen the filters first.</div>;
  const cost = groupCost(g, party);
  return (
    <div>
      <div class="pick-card">
        <button class="thumb" onClick={() => onOpen(g)} aria-label={g.name}>
          <Art game={g} eager />
        </button>
        <div class="t">
          <span class="label">Tonight you play</span>
          <h3>{g.name}</h3>
          <div class="num" style={{ color: 'var(--text-2)', fontSize: 'var(--t2)' }}>
            {g.rev.pct}% of {compact(g.rev.pos + g.rev.neg)} · {usd(g.price.now)} · {modeChips(g).join(', ')}
          </div>
          <div class="num" style={{ marginTop: '8px', fontSize: 'var(--t2)' }}>
            {g.price.free ? 'Free for everyone' : cost.copies === 1 ? `${usdShort(cost.cents)} for one copy, the rest join with Remote Play Together` : `${usdShort(cost.cents)} for ${cost.copies} copies`}
          </div>
          {g.pick ? <p class="pickline" style={{ fontFamily: 'var(--font-editorial)', marginTop: '8px', marginBottom: 0 }}>{g.pick}</p> : null}
        </div>
      </div>
      <div class="btnrow" style={{ padding: '0 16px 16px' }}>
        <button class="btn primary" onClick={onReroll}>
          <Icon.Dice /> Reroll
        </button>
        <a class="btn" href={steamStoreUrl(g.id)} target="_blank" rel="noopener">
          <Icon.External /> Steam
        </a>
        <button class={`btn ${saved ? '' : 'info'}`} onClick={() => onToggleSave(g)}>
          {saved ? <Icon.Check /> : <Icon.Plus />} {saved ? 'Saved' : 'Shortlist'}
        </button>
      </div>
    </div>
  );
}
