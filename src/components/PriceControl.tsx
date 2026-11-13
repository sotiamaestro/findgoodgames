import { PRICE_CAP } from '../lib/filters';

type Props = { value: number; histogram: number[]; onChange: (v: number) => void };

/** Airbnb-style price histogram with a single max-price thumb (we only cap the top end). */
export function PriceControl({ value, histogram, onChange }: Props) {
  const max = Math.max(1, ...histogram);
  const step = PRICE_CAP / histogram.length;
  return (
    <div class="pricectl">
      <div class="cur num">{value >= PRICE_CAP ? 'Any price' : value === 0 ? 'Free only' : `Up to $${value}`}</div>
      <div class="hist" aria-hidden="true">
        {histogram.map((n, i) => {
          const bucketStart = i * step;
          const inRange = value >= PRICE_CAP || bucketStart < value || (value === 0 && i === 0);
          return <i key={i} class={inRange ? 'in' : ''} style={{ height: `${Math.max(3, (100 * n) / max)}%` }} />;
        })}
      </div>
      <input
        type="range"
        min={0}
        max={PRICE_CAP}
        step={1}
        value={value}
        aria-label="Maximum price in US dollars"
        onInput={(e) => onChange(Number((e.currentTarget as HTMLInputElement).value))}
      />
      <div class="ends num">
        <span>Free</span>
        <span>$30</span>
        <span>$60+</span>
      </div>
    </div>
  );
}
