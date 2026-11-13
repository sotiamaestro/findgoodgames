// Rate-limited fetch: one serial queue per host, a minimum gap between
// requests per host (and optionally per request "kind" within a host), and a
// long back-off on 429/403 for the Steam store.

export const USER_AGENT =
  'coop-finder-pipeline/0.1 (open-source co-op game finder; weekly data refresh)';

/** Minimum milliseconds between two requests to the same host. */
export const HOST_GAP_MS: Record<string, number> = {
  'store.steampowered.com': 1600,
  'api.steampowered.com': 1000,
  'steamspy.com': 1000,
  'www.pcgamingwiki.com': 1000,
  'api-prod.nvidia.com': 1000,
  'static.nvidiagrid.net': 500,
  'shared.akamai.steamstatic.com': 300,
};

/** Minimum gap for a named request kind inside a host (SteamSpy tag requests: 1 per 60 s). */
export const KIND_GAP_MS: Record<string, number> = {
  'steamspy.com#tag': 60_000,
};

/** Hosts that get the long back-off on 429/403 (Steam store: ~200 requests per 5 minutes per IP). */
const BACKOFF_HOSTS = new Set(['store.steampowered.com', 'api.steampowered.com']);
export const BACKOFF_MS = 5 * 60_000;
export const MAX_BACKOFF_RETRIES = 3;

export class RateLimitedError extends Error {
  constructor(public url: string, public status: number) {
    super(`rate limited after ${MAX_BACKOFF_RETRIES} retries: ${status} ${url}`);
  }
}

class HostQueue {
  private chain: Promise<unknown> = Promise.resolve();
  private last = 0;
  private lastByKind = new Map<string, number>();
  constructor(private host: string) {}

  run<T>(fn: () => Promise<T>, kind?: string): Promise<T> {
    const task = this.chain.then(async () => {
      const hostGap = HOST_GAP_MS[this.host] ?? 500;
      let waitUntil = this.last + hostGap;
      if (kind) {
        const key = `${this.host}#${kind}`;
        const kindGap = KIND_GAP_MS[key] ?? 0;
        waitUntil = Math.max(waitUntil, (this.lastByKind.get(key) ?? 0) + kindGap);
      }
      const delay = waitUntil - Date.now();
      if (delay > 0) await sleep(delay);
      try {
        return await fn();
      } finally {
        const now = Date.now();
        this.last = now;
        if (kind) this.lastByKind.set(`${this.host}#${kind}`, now);
      }
    });
    // Keep the chain alive even when a task rejects.
    this.chain = task.catch(() => undefined);
    return task;
  }
}

const queues = new Map<string, HostQueue>();
function queueFor(host: string): HostQueue {
  let q = queues.get(host);
  if (!q) {
    q = new HostQueue(host);
    queues.set(host, q);
  }
  return q;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type FetchOptions = {
  method?: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Request kind inside the host, for extra gaps (e.g. "tag" on steamspy.com). */
  kind?: string;
  /** Override the back-off retry count (default MAX_BACKOFF_RETRIES for Steam hosts, 0 elsewhere). */
  backoffRetries?: number;
  /** Called before a back-off wait, so callers can log it. */
  onBackoff?: (status: number, attempt: number) => void;
  /** Called with the log line after each request. */
  log?: (line: string) => void;
};

export type FetchResult = {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
  ms: number;
};

/**
 * Fetch through the per-host serial queue. Never throws on HTTP errors except
 * when the Steam back-off is exhausted (RateLimitedError); network errors
 * propagate.
 */
export async function rlFetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const host = new URL(url).host;
  const retries = opts.backoffRetries ?? (BACKOFF_HOSTS.has(host) ? MAX_BACKOFF_RETRIES : 0);
  return queueFor(host).run(async () => {
    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
      let res: Response;
      try {
        res = await fetch(url, {
          method: opts.method ?? 'GET',
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/plain, */*', ...opts.headers },
          body: opts.body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const text = opts.method === 'HEAD' ? '' : await res.text();
      const ms = Date.now() - started;
      opts.log?.(`${res.status} ${ms}ms ${opts.method ?? 'GET'} ${url.slice(0, 140)}`);
      if ((res.status === 429 || res.status === 403) && attempt < retries) {
        opts.onBackoff?.(res.status, attempt + 1);
        await sleep(BACKOFF_MS);
        continue;
      }
      if ((res.status === 429 || res.status === 403) && retries > 0) {
        throw new RateLimitedError(url, res.status);
      }
      return { status: res.status, ok: res.ok, headers: res.headers, text, ms };
    }
  }, opts.kind);
}

export async function rlJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<{ data: T | null; res: FetchResult }> {
  const res = await rlFetch(url, opts);
  let data: T | null = null;
  if (res.text) {
    try {
      data = JSON.parse(res.text) as T;
    } catch {
      data = null;
    }
  }
  return { data, res };
}
