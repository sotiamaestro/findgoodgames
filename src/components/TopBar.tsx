import { useState } from 'preact/hooks';
import { Icon } from './icons';

type Props = {
  shortlistCount: number;
  onCheck: (query: string) => void;
  onShortlist: () => void;
  onHome: () => void;
  shortlistActive: boolean;
};

export function TopBar({ shortlistCount, onCheck, onShortlist, onHome, shortlistActive }: Props) {
  const [q, setQ] = useState('');
  return (
    <header class="topbar">
      <a
        class="brand"
        href="/"
        onClick={(e) => {
          e.preventDefault();
          onHome();
        }}
      >
        Co-op Finder
      </a>
      <form
        class="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) onCheck(q.trim());
        }}
      >
        <input
          type="search"
          value={q}
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
          placeholder="Check a game"
          aria-label="Check a game"
          autocomplete="off"
          enterkeyhint="search"
        />
        <button type="submit" class="go" aria-label="Check">
          Check
        </button>
      </form>
      <button class={`iconbtn ${shortlistActive ? 'active' : ''}`} onClick={onShortlist} aria-label={`Shortlist, ${shortlistCount} games`}>
        <Icon.Bookmark />
        {shortlistCount ? <span class="count num">{shortlistCount}</span> : null}
      </button>
    </header>
  );
}
