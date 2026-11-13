import type { Game } from '@shared/types';
import { useEffect, useRef, useState } from 'preact/hooks';
import { GameCard } from './Card';

const PAGE = 60;

type Props = {
  games: Game[];
  party: number;
  preferLocal: boolean;
  showEa: boolean;
  tagNames: string[];
  shortlist: Set<number>;
  onOpen: (g: Game) => void;
  onToggleSave: (g: Game) => void;
  resetKey: string;
};

export function Grid({ games, party, preferLocal, showEa, tagNames, shortlist, onOpen, onToggleSave, resetKey }: Props) {
  const [visible, setVisible] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => setVisible(PAGE), [resetKey]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || visible >= games.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible((v) => Math.min(games.length, v + PAGE));
      },
      { rootMargin: '800px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, games.length]);

  if (!games.length) {
    return (
      <div class="empty">
        <b>Nothing matches these filters</b>
        Try a higher price cap, a smaller party, or turn off GeForce NOW only.
      </div>
    );
  }

  return (
    <>
      <div class="grid">
        {games.slice(0, visible).map((g, i) => (
          <GameCard
            key={g.id}
            game={g}
            party={party}
            preferLocal={preferLocal}
            saved={shortlist.has(g.id)}
            showEa={showEa}
            eager={i < 6}
            tagNames={tagNames}
            onOpen={onOpen}
            onToggleSave={onToggleSave}
          />
        ))}
      </div>
      {visible < games.length ? <div class="sentinel" ref={sentinel} /> : null}
    </>
  );
}
