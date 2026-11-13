import { timeAgo } from '../lib/format';

type Props = { generatedAt: string | null; source: string | null; count: number };

export function Footer({ generatedAt, source, count }: Props) {
  return (
    <footer class="footer">
      <p>
        {generatedAt ? <>Data updated {timeAgo(generatedAt)}. </> : null}
        {count ? <>{count.toLocaleString()} co-op games tracked. </> : null}
        Prices are in USD and come from the US Steam store. Every fact on a card is pulled from live data by a scheduled pipeline; the only hand-written text is the Crew Picks one-liners.
      </p>
      <p>
        Not affiliated with Valve or NVIDIA. Steam and the Steam logo are trademarks of Valve Corporation. GeForce NOW is a trademark of NVIDIA Corporation.
      </p>
      <p>
        Sources: <a href="https://store.steampowered.com/" rel="noopener" target="_blank">Steam</a> (store data, categories, reviews),{' '}
        <a href="https://www.nvidia.com/en-us/geforce-now/games/" rel="noopener" target="_blank">NVIDIA's GeForce NOW game list</a>,{' '}
        <a href="https://steamspy.com/" rel="noopener" target="_blank">SteamSpy</a> (candidate list), and{' '}
        <a href="https://www.pcgamingwiki.com/" rel="noopener" target="_blank">PCGamingWiki</a> (player counts, used under{' '}
        <a href="https://creativecommons.org/licenses/by-nc-sa/3.0/" rel="noopener" target="_blank">CC BY-NC-SA 3.0</a>).
        {source && source.startsWith('/') ? ' Showing the bundled snapshot because the live data file could not be fetched.' : ''}
      </p>
    </footer>
  );
}
