import type { Game } from '@shared/types';
import type { RowDef } from '../lib/filters';
import { EditorialCard, PosterCard } from './Card';

type Props = { rows: RowDef[]; onOpen: (g: Game) => void; showEa: boolean };

export function Rows({ rows, onOpen, showEa }: Props) {
  return (
    <>
      {rows.map((row, rowIndex) => (
        <section class="row" key={row.key} aria-label={row.title}>
          <div class="row-head">
            <div>
              <span class="label">{row.label}</span>
              <h2 class={row.editorial ? 'editorial' : ''}>{row.title}</h2>
            </div>
            <span class="more num">{row.games.length} game{row.games.length === 1 ? "" : "s"}</span>
          </div>
          <div class="strip">
            {row.key === 'picks'
              ? row.games.slice(0, 24).map((g, i) => <EditorialCard key={g.id} game={g} onOpen={onOpen} eager={rowIndex === 0 && i < 2} />)
              : row.games.slice(0, 24).map((g, i) => <PosterCard key={g.id} game={g} rank={i + 1} onOpen={onOpen} showEa={showEa} eager={rowIndex === 0 && i < 4} />)}
          </div>
        </section>
      ))}
    </>
  );
}
