import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Game } from '@shared/types';
import { TAG_FILTER_COUNT } from '@shared/config';
import { loadDataset, readBootstrap, type LoadedData } from './lib/data';
import { applyFilters, buildRows, defaultFilters, filtersFromParams, filtersToParams, isDefault, priceHistogram, summarize, weightedPick, type Filters } from './lib/filters';
import { copyText, readShortlist, shortlistText, writeShortlist } from './lib/shortlist';
import { TopBar } from './components/TopBar';
import { Rows } from './components/Rows';
import { Grid } from './components/Grid';
import { FilterPanel } from './components/FilterPanel';
import { Sheet } from './components/Sheet';
import { Detail } from './components/Detail';
import { CheckGame } from './components/CheckGame';
import { Shortlist } from './components/Shortlist';
import { PickForUs } from './components/PickForUs';
import { Footer } from './components/Footer';
import { Icon } from './components/icons';

type View = 'home' | 'shortlist';
type UrlState = { filters: Filters; view: View; detailId: number | null; check: string | null };

function readUrl(): UrlState {
  const p = new URLSearchParams(location.search);
  const id = Number(p.get('g'));
  return {
    filters: filtersFromParams(p),
    view: p.get('view') === 'shortlist' ? 'shortlist' : 'home',
    detailId: Number.isInteger(id) && id > 0 ? id : null,
    check: p.get('check'),
  };
}

function urlFor(s: UrlState): string {
  const p = filtersToParams(s.filters);
  if (s.view === 'shortlist') p.set('view', 'shortlist');
  if (s.detailId) p.set('g', String(s.detailId));
  if (s.check) p.set('check', s.check);
  const qs = p.toString();
  return location.pathname + (qs ? `?${qs}` : '');
}

export function App() {
  const [url, setUrlState] = useState<UrlState>(() => readUrl());
  const [data, setData] = useState<LoadedData | null>(() =>
    isDefault(url.filters) && url.view === 'home' && !url.check && !url.detailId ? readBootstrap() : null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draft, setDraft] = useState<Filters | null>(null); // filters being edited in the mobile sheet
  const [pick, setPick] = useState<Game | null | undefined>(undefined); // undefined = closed
  const [shortlist, setShortlist] = useState<number[]>(() => readShortlist());
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  // ---- data
  useEffect(() => {
    loadDataset().then(setData, (err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);

  // ---- url sync
  const setUrl = useCallback((next: UrlState, push = false) => {
    setUrlState(next);
    const href = urlFor(next);
    if (href !== location.pathname + location.search) {
      if (push) history.pushState(null, '', href);
      else history.replaceState(null, '', href);
    }
  }, []);
  useEffect(() => {
    const onPop = () => setUrlState(readUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const filters = url.filters;
  const setFilters = (f: Filters) => setUrl({ ...url, filters: f });

  // ---- derived
  const games = data?.dataset.games ?? [];
  const tagNames = data?.dataset.tagNames ?? [];
  const partial = !!data?.partial;
  const tagIndex = useMemo(() => new Map(tagNames.map((t, i) => [t, i])), [tagNames]);
  const tagOptions = useMemo(() => {
    if (partial) return [];
    const freq = new Map<number, number>();
    for (const g of games) for (const t of g.tags) freq.set(t, (freq.get(t) ?? 0) + 1);
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TAG_FILTER_COUNT)
      .map(([i]) => tagNames[i]!)
      .sort((a, b) => a.localeCompare(b));
  }, [games, tagNames, partial]);

  const results = useMemo(() => applyFilters(games, filters, tagIndex), [games, filters, tagIndex]);
  const rows = useMemo(() => buildRows(games, filters), [games, filters]);
  const effective = draft ?? filters;
  const histogram = useMemo(() => priceHistogram(games, effective, tagIndex), [games, effective, tagIndex]);
  const draftCount = useMemo(() => (draft ? applyFilters(games, draft, tagIndex).length : results.length), [games, draft, tagIndex, results.length]);
  const shortlistSet = useMemo(() => new Set(shortlist), [shortlist]);
  const shortlistGames = useMemo(() => shortlist.map((id) => data?.byId.get(id)).filter((g): g is Game => !!g), [shortlist, data]);
  const detailGame = url.detailId ? data?.byId.get(url.detailId) ?? null : null;
  const preferLocal = filters.oneCopy || (filters.modes.length > 0 && filters.modes.every((m) => m === 'local' || m === 'split'));

  // ---- actions
  const showToast = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  };
  const openGame = (g: Game) => setUrl({ ...url, detailId: g.id }, true);
  const closeDetail = useCallback(() => setUrl({ ...url, detailId: null }), [url, setUrl]);
  const closeCheck = useCallback(() => setUrl({ ...url, check: null }), [url, setUrl]);
  const toggleSave = (g: Game) => {
    const next = shortlistSet.has(g.id) ? shortlist.filter((id) => id !== g.id) : [...shortlist, g.id];
    setShortlist(next);
    writeShortlist(next);
    showToast(shortlistSet.has(g.id) ? 'Removed from shortlist' : 'Added to shortlist');
  };
  const copyLink = async () => {
    const ok = await copyText(location.href);
    showToast(ok ? 'Link copied' : 'Could not copy');
  };
  const copyShortlist = async () => {
    const ok = await copyText(shortlistText(shortlistGames));
    showToast(ok ? 'Shortlist copied' : 'Could not copy');
  };
  const openFilters = () => {
    setDraft(filters);
    setFiltersOpen(true);
  };
  const cancelFilters = useCallback(() => {
    setDraft(null);
    setFiltersOpen(false);
  }, []);
  const applyDraft = () => {
    if (draft) setFilters(draft);
    setDraft(null);
    setFiltersOpen(false);
  };
  const closePick = useCallback(() => setPick(undefined), []);

  const resultsKey = filtersToParams(filters).toString();

  return (
    <>
      <TopBar
        shortlistCount={shortlist.length}
        shortlistActive={url.view === 'shortlist'}
        onCheck={(q) => setUrl({ ...url, check: q }, true)}
        onShortlist={() => setUrl({ ...url, view: url.view === 'shortlist' ? 'home' : 'shortlist', detailId: null }, true)}
        onHome={() => setUrl({ filters: defaultFilters(), view: 'home', detailId: null, check: null }, true)}
      />

      <div class="shell">
        <aside class="rail" aria-label="Filters">
          {data ? <FilterPanel filters={filters} onChange={setFilters} tagOptions={tagOptions} histogram={histogram} variant="rail" /> : null}
        </aside>

        <main class="main">
          {loadError && !data ? (
            <div class="empty">
              <b>Could not load the game list</b>
              {loadError}. Try again in a minute.
            </div>
          ) : null}

          {!data && !loadError ? (
            <div class="grid skeleton" aria-busy="true" aria-label="Loading games">
              {Array.from({ length: 12 }, (_, i) => (
                <div class="card" key={i}>
                  <div class="art" />
                  <div class="bar" style={{ width: '80%' }} />
                  <div class="bar" style={{ width: '50%' }} />
                </div>
              ))}
            </div>
          ) : null}

          {data && url.view === 'shortlist' ? (
            <Shortlist
              games={shortlistGames}
              party={filters.party}
              onOpen={openGame}
              onRemove={toggleSave}
              onCopy={copyShortlist}
              onClear={() => {
                setShortlist([]);
                writeShortlist([]);
              }}
              onBack={() => setUrl({ ...url, view: 'home' }, true)}
            />
          ) : null}

          {data && url.view === 'home' ? (
            <>
              <div class="mobile-tools">
                <button class="pillbtn" onClick={openFilters}>
                  <Icon.Filter /> Filters{isDefault(filters) ? '' : ' (on)'}
                </button>
                <button class="pillbtn" onClick={() => setPick(weightedPick(results))} disabled={!results.length}>
                  <Icon.Dice /> Pick for us
                </button>
                <button class="pillbtn" onClick={copyLink}>
                  <Icon.Link /> Copy link
                </button>
              </div>

              <Rows rows={rows} onOpen={openGame} showEa={!filters.hideEa} />

              <div class="results-head">
                <h1 class="num">
                  All matches {partial ? null : <span>{results.length.toLocaleString()}</span>}
                </h1>
                <div class="actions">
                  <button class="pillbtn" onClick={() => setPick(weightedPick(results))} disabled={!results.length}>
                    <Icon.Dice /> Pick for us
                  </button>
                  <button class="pillbtn" onClick={copyLink}>
                    <Icon.Link /> Copy link
                  </button>
                  {!isDefault(filters) ? (
                    <button class="pillbtn warn" onClick={() => setFilters(defaultFilters())}>
                      Reset
                    </button>
                  ) : null}
                </div>
              </div>
              <div class="active-filters" aria-label="Active filters">
                {summarize(filters).map((s) => (
                  <span class="chip" key={s}>
                    {s}
                  </span>
                ))}
              </div>

              <Grid
                games={results}
                party={filters.party}
                preferLocal={preferLocal}
                showEa={!filters.hideEa}
                tagNames={tagNames}
                shortlist={shortlistSet}
                onOpen={openGame}
                onToggleSave={toggleSave}
                resetKey={resultsKey}
              />
            </>
          ) : null}

          <Footer generatedAt={partial ? null : data?.dataset.generatedAt ?? null} source={partial ? null : data?.source ?? null} count={partial ? 0 : games.length} />
        </main>
      </div>

      {filtersOpen && draft ? (
        <Sheet
          title="Filters"
          onClose={cancelFilters}
          left={<button onClick={cancelFilters}>Cancel</button>}
          right={<button onClick={applyDraft}>Done</button>}
          footer={
            <>
              <button class="pillbtn warn" onClick={() => setDraft(defaultFilters())}>
                Reset
              </button>
              <button class="showbtn num" onClick={applyDraft}>
                Show {draftCount.toLocaleString()} game{draftCount === 1 ? '' : 's'}
              </button>
            </>
          }
        >
          <FilterPanel filters={draft} onChange={setDraft} tagOptions={tagOptions} histogram={histogram} variant="sheet" />
        </Sheet>
      ) : null}

      {detailGame ? (
        <Sheet title="" label={detailGame.name} variant="detail" side onClose={closeDetail} left={<button onClick={closeDetail}>Close</button>} right={<button onClick={copyLink}>Copy link</button>}>
          <Detail game={detailGame} party={filters.party} tagNames={tagNames} saved={shortlistSet.has(detailGame.id)} onToggleSave={toggleSave} />
        </Sheet>
      ) : null}

      {url.check && data ? (
        <Sheet title="Check a game" variant="detail" side onClose={closeCheck} left={<button onClick={closeCheck}>Close</button>}>
          <CheckGame
            query={url.check}
            games={games}
            byId={data.byId}
            onOpenGame={(g) => setUrl({ ...url, check: null, detailId: g.id }, true)}
          />
        </Sheet>
      ) : null}

      {pick !== undefined ? (
        <Sheet title="Pick for us" variant="detail" side onClose={closePick} left={<button onClick={closePick}>Close</button>}>
          <PickForUs
            game={pick}
            party={filters.party}
            saved={pick ? shortlistSet.has(pick.id) : false}
            onReroll={() => setPick(weightedPick(results, pick?.id))}
            onOpen={(g) => {
              setPick(undefined);
              openGame(g);
            }}
            onToggleSave={toggleSave}
          />
        </Sheet>
      ) : null}

      {toast ? (
        <div class="toast" role="status">
          {toast}
        </div>
      ) : null}
    </>
  );
}
