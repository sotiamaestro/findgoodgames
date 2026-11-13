import type { Game } from '@shared/types';
import type { RowDef } from '../lib/filters';
import { PosterCard } from './Card';

type Props = { rows: RowDef[]; onOpen: (g: Game) => void; showEa: boolean };

export function Rows({ rows, onOpen, showEa }: Props) {
  return (
    <>
      {rows.map((row) => (
        <section class="row" key={row.key} aria-label={row.title}>
          <div class="row-head">
            <div>
              <span class="label">{row.label}</span>
              <h2 class={row.editorial ? 'editorial' : ''}>{row.title}</h2>
            </div>
            <span class="more num">{row.games.length} game{row.games.length === 1 ? "" : "s"}</span>
          </div>
          <div class="strip">
            {row.games.slice(0, 24).map((g, i) => (
              <PosterCard key={g.id} game={g} rank={row.key === 'picks' ? undefined : i + 1} onOpen={onOpen} showEa={showEa} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
