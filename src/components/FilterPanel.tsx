import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { SORT_LABELS, type SortKey } from '@shared/config';
import { MODES, PARTY_MAX, PCT_STEPS, PRICE_CAP, REVIEW_STEPS, defaultFilters, type Filters, type Mode } from '../lib/filters';
import { PriceControl } from './PriceControl';
import { Icon } from './icons';

type Props = {
  filters: Filters;
  onChange: (f: Filters) => void;
  tagOptions: string[];
  histogram: number[];
  variant: 'sheet' | 'rail';
};

function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return <button class={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={onToggle} />;
}

function Row({ label, value, open, onClick, children, control }: { label: string; value: string; open: boolean; onClick: () => void; children?: ComponentChildren; control?: ComponentChildren }) {
  return (
    <>
      {control ? (
        <div class="frow">
          <span>{label}</span>
          <span class="val">{control}</span>
        </div>
      ) : (
        <button class={`frow ${open ? 'open' : ''}`} onClick={onClick} aria-expanded={open}>
          <span>{label}</span>
          <span class="val num">
            {value}
            <Icon.Chevron />
          </span>
        </button>
      )}
      {open && children ? <div class="fcontrol">{children}</div> : null}
    </>
  );
}

export function FilterPanel({ filters: f, onChange, tagOptions, histogram, variant }: Props) {
  const [open, setOpen] = useState<string | null>(variant === 'rail' ? 'price' : null);
  const toggle = (k: string) => setOpen((o) => (o === k ? null : k));
  const set = (patch: Partial<Filters>) => onChange({ ...f, ...patch });
  const modeLabel = f.modes.length ? f.modes.map((m) => MODES.find((x) => x.key === m)!.label).join(', ') : 'Any';
  const tagLabel = f.tags.length ? (f.tags.length <= 2 ? f.tags.join(', ') : `${f.tags.length} tags`) : 'Any';
  const onSurface = variant === 'sheet' ? 'on-surface' : '';

  return (
    <div class={`fpanel fpanel-${variant}`}>
      <div class="fgroup">
        <Row label="Sort by" value={SORT_LABELS[f.sort]} open={open === 'sort'} onClick={() => toggle('sort')}>
          <div class="optlist" role="radiogroup" aria-label="Sort by">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <button key={k} class={f.sort === k ? 'on' : ''} role="radio" aria-checked={f.sort === k} onClick={() => set({ sort: k })}>
                {SORT_LABELS[k]}
              </button>
            ))}
          </div>
        </Row>
      </div>

      <div class="fgroup">
        <span class={`label ${onSurface}`}>Price</span>
        <Row label="Max price" value={f.maxPrice >= PRICE_CAP ? 'Any' : f.maxPrice === 0 ? 'Free' : `$${f.maxPrice}`} open={open === 'price'} onClick={() => toggle('price')}>
          <PriceControl value={f.maxPrice} histogram={histogram} onChange={(v) => set({ maxPrice: v })} />
        </Row>
        <Row label="On sale now" value="" open={false} onClick={() => undefined} control={<Switch on={f.onSale} onToggle={() => set({ onSale: !f.onSale })} label="On sale now" />} />
      </div>

      <div class="fgroup">
        <span class={`label ${onSurface}`}>Your group</span>
        <Row label="Party size" value={f.party >= PARTY_MAX ? '8+' : String(f.party)} open={open === 'party'} onClick={() => toggle('party')}>
          <div class="seg" role="radiogroup" aria-label="Party size">
            {[2, 3, 4, 5, 6, 7, 8].map((n) => (
              <button key={n} class={`num ${f.party === n ? 'on' : ''}`} role="radio" aria-checked={f.party === n} onClick={() => set({ party: n })}>
                {n === 8 ? '8+' : n}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Co-op mode" value={modeLabel} open={open === 'modes'} onClick={() => toggle('modes')}>
          <div class="tagwrap" role="group" aria-label="Co-op mode">
            {MODES.map((m) => {
              const on = f.modes.includes(m.key);
              return (
                <button key={m.key} class={`tagpill ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => set({ modes: on ? f.modes.filter((x) => x !== m.key) : [...f.modes, m.key as Mode] })}>
                  {m.label}
                </button>
              );
            })}
          </div>
        </Row>
        <Row label="1 copy is enough" value="" open={false} onClick={() => undefined} control={<Switch on={f.oneCopy} onToggle={() => set({ oneCopy: !f.oneCopy })} label="One copy is enough: Remote Play Together plus local co-op" />} />
        <Row label="Confirmed player count only" value="" open={false} onClick={() => undefined} control={<Switch on={f.confirmedPlayers} onToggle={() => set({ confirmedPlayers: !f.confirmedPlayers })} label="Confirmed player count only" />} />
      </div>

      <div class="fgroup">
        <span class={`label ${onSurface}`}>Platform</span>
        <Row label="GeForce NOW only" value="" open={false} onClick={() => undefined} control={<Switch on={f.gfn} onToggle={() => set({ gfn: !f.gfn })} label="GeForce NOW only" />} />
        <Row label="Show Early Access" value="" open={false} onClick={() => undefined} control={<Switch on={!f.hideEa} onToggle={() => set({ hideEa: !f.hideEa })} label="Show Early Access games" />} />
        <Row label="Hide MMOs" value="" open={false} onClick={() => undefined} control={<Switch on={f.hideMmo} onToggle={() => set({ hideMmo: !f.hideMmo })} label="Hide MMOs" />} />
      </div>

      <div class="fgroup">
        <span class={`label ${onSurface}`}>Reviews</span>
        <Row label="Minimum % positive" value={`${f.minPct}%`} open={open === 'pct'} onClick={() => toggle('pct')}>
          <div class="seg" role="radiogroup" aria-label="Minimum percent positive">
            {PCT_STEPS.map((n) => (
              <button key={n} class={`num ${f.minPct === n ? 'on' : ''}`} role="radio" aria-checked={f.minPct === n} onClick={() => set({ minPct: n })}>
                {n}%
              </button>
            ))}
          </div>
        </Row>
        <Row label="Minimum reviews" value={f.minReviews.toLocaleString()} open={open === 'rev'} onClick={() => toggle('rev')}>
          <div class="seg" role="radiogroup" aria-label="Minimum review count">
            {REVIEW_STEPS.map((n) => (
              <button key={n} class={`num ${f.minReviews === n ? 'on' : ''}`} role="radio" aria-checked={f.minReviews === n} onClick={() => set({ minReviews: n })}>
                {n >= 1000 ? `${n / 1000}k` : n}
              </button>
            ))}
          </div>
        </Row>
      </div>

      <div class="fgroup">
        <span class={`label ${onSurface}`}>Tags</span>
        <Row label="Tags" value={tagLabel} open={open === 'tags'} onClick={() => toggle('tags')}>
          <div class="tagwrap" role="group" aria-label="Tags">
            {tagOptions.map((t) => {
              const on = f.tags.includes(t);
              return (
                <button key={t} class={`tagpill ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => set({ tags: on ? f.tags.filter((x) => x !== t) : [...f.tags, t] })}>
                  {t}
                </button>
              );
            })}
          </div>
        </Row>
      </div>

      <button class="reset" onClick={() => onChange(defaultFilters())}>
        Reset filters
      </button>
    </div>
  );
}
