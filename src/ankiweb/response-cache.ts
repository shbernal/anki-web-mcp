import { AnkiWebHttpError } from "./http-error.js";
import { ankiWebThrottle, REQUEST_TIMEOUT_MS } from "./throttle.js";

const MS_PER_SECOND = 1000;
/** Enough for a session's worth of searches; a large result set is about 100 kB. */
const MAX_ENTRIES = 50;
const MAX_AGE = /(?:^|,)\s*max-age=(?<seconds>\d+)/u;

/** What a request to AnkiWeb may carry beyond its URL; a GET with no headers by default. */
export type AnkiWebRequest = Readonly<{
  method?: "GET" | "POST";
  headers?: Readonly<Record<string, string>>;
  body?: Readonly<Uint8Array<ArrayBuffer>>;
}>;

/** The slice of `fetch` this needs, which a test can stand in for. */
export type Fetch = (
  url: string,
  init?: AnkiWebRequest & Readonly<{ signal?: AbortSignal }>,
) => Promise<Response>;

/**
 * Sends one request to AnkiWeb, after the throttle's gap, and gives up if the
 * response headers take longer than `REQUEST_TIMEOUT_MS`. The body is not
 * covered, since a deck can take minutes to stream.
 */
export async function fetchAnkiWeb(
  fetcher: Fetch,
  url: string,
  request: AnkiWebRequest = {},
): Promise<Response> {
  await ankiWebThrottle.wait();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("AnkiWeb did not answer in time", "TimeoutError"));
  }, REQUEST_TIMEOUT_MS);
  try {
    return await fetcher(url, { ...request, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface ResponseCacheOptions {
  readonly fetch?: Fetch;
  readonly now?: () => number;
}

interface Entry {
  readonly expires: number;
  readonly body: Uint8Array;
}

/**
 * Anonymous GETs against AnkiWeb, each body kept for as long as its
 * `cache-control: max-age` allows. That matters more than it would elsewhere:
 * AnkiWeb answers 429 after about four searches a minute.
 */
export class ResponseCache {
  readonly #fetch: Fetch;
  readonly #now: () => number;
  readonly #entries = new Map<string, Entry>();

  constructor(options: ResponseCacheOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  async get(url: string): Promise<Uint8Array> {
    const cached = this.#entries.get(url);
    if (cached !== undefined && cached.expires > this.#now()) {
      return cached.body;
    }
    const response = await fetchAnkiWeb(this.#fetch, url);
    if (!response.ok) {
      throw new AnkiWebHttpError(response.status, await response.text(), url);
    }
    const body = new Uint8Array(await response.arrayBuffer());
    const maxAge = MAX_AGE.exec(response.headers.get("cache-control") ?? "")?.groups?.seconds;
    if (maxAge !== undefined) {
      this.#evict();
      this.#entries.set(url, { expires: this.#now() + Number(maxAge) * MS_PER_SECOND, body });
    }
    return body;
  }

  /** Drops what has expired, then the oldest entries until there is room for one more. */
  #evict(): void {
    const now = this.#now();
    for (const [url, entry] of this.#entries) {
      if (entry.expires <= now || this.#entries.size >= MAX_ENTRIES) {
        this.#entries.delete(url);
      }
    }
  }
}
