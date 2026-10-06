import { AnkiWebHttpError } from "./http-error.js";

const MS_PER_SECOND = 1000;
/** Enough for a session's worth of searches; a large result set is about 100 kB. */
const MAX_ENTRIES = 50;
const MAX_AGE = /(?:^|,)\s*max-age=(?<seconds>\d+)/u;

/** The slice of `fetch` this needs, which a test can stand in for. */
export type Fetch = (url: string) => Promise<Response>;

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
    const response = await this.#fetch(url);
    if (!response.ok) {
      throw new AnkiWebHttpError(response.status, await response.text());
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
