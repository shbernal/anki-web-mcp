import type { BrowserContext } from "playwright";

import { checkLoggedIn } from "../ankiweb/account.js";
import { type DataDir, ensureDataDir } from "../data-dir.js";
import { AuthRequiredError } from "./auth-required-error.js";
import {
  authCookies,
  hasSessionCookie,
  readStoredSession,
  SESSION_DOMAIN_PATTERN,
  SESSION_URLS,
  type StoredCookie,
  writeStoredSession,
} from "./cookies.js";
import { launchContext, type LaunchOptions } from "./launch.js";

/** Five minutes. */
const DEFAULT_IDLE_MS = 300_000;
/** Long enough that one tool call validating more than once costs one request. */
const VALIDATION_TTL_MS = 30_000;

export interface SessionOptions {
  readonly dataDir: DataDir;
  readonly channel?: string | undefined;
  readonly idleMs?: number;
  /** Replaces Playwright in tests. */
  readonly launch?: (options: LaunchOptions) => Promise<BrowserContext>;
  readonly checkLoggedIn?: (context: BrowserContext) => Promise<boolean>;
  /**
   * Brings in a session from elsewhere, such as a local browser, handing each
   * candidate to `adopt` until one is accepted. Tried once per process, the
   * first time a call needs a session that is not there; leave it out to never
   * try. Rejects with the reason nothing was imported.
   */
  readonly autoImport?: ((adopt: AdoptCookies) => Promise<unknown>) | undefined;
}

/** Resolves to whether AnkiWeb accepted the cookies, which are kept only if it did. */
export type AdoptCookies = (cookies: readonly StoredCookie[]) => Promise<boolean>;

/**
 * The server's one browser. The first call launches a headless persistent
 * context, later calls share it, and it closes after `idleMs` with nothing in
 * flight. It never opens a headed window: a stdio client may have no display,
 * so signing in is left to `--login`.
 */
export class BrowserSession {
  readonly #options: SessionOptions;
  #context: Promise<BrowserContext> | undefined;
  #active = 0;
  #idleTimer: NodeJS.Timeout | undefined;
  #validated: { readonly at: number; readonly loggedIn: boolean } | undefined;
  #imported: Promise<unknown> | undefined;

  constructor(options: SessionOptions) {
    this.#options = options;
  }

  /** When a session check last succeeded in this process, if one has. */
  get lastValidatedAt(): Date | undefined {
    return this.#validated?.loggedIn === true ? new Date(this.#validated.at) : undefined;
  }

  async use<Result>(task: (context: BrowserContext) => Promise<Result>): Promise<Result> {
    this.#active += 1;
    clearTimeout(this.#idleTimer);
    try {
      return await task(await this.#open());
    } finally {
      this.#active -= 1;
      this.#armIdleTimer();
    }
  }

  useAuthenticated<Result>(task: (context: BrowserContext) => Promise<Result>): Promise<Result> {
    return this.use(async (context) => {
      if (!(await this.#isAuthenticated(context))) {
        await this.#importOnce(context);
      }
      return task(context);
    });
  }

  adoptCookies(cookies: readonly StoredCookie[]): Promise<boolean> {
    return this.use((context) => this.#adopt(context, cookies));
  }

  isAuthenticated(): Promise<boolean> {
    return this.use((context) => this.#isAuthenticated(context));
  }

  async close(): Promise<void> {
    clearTimeout(this.#idleTimer);
    const context = this.#context;
    this.#context = undefined;
    this.#validated = undefined;
    if (context !== undefined) {
      const opened = await context;
      await opened.close();
    }
  }

  #armIdleTimer(): void {
    if (this.#active > 0 || this.#context === undefined) {
      return;
    }
    this.#idleTimer = setTimeout(() => {
      void this.close();
    }, this.#options.idleMs ?? DEFAULT_IDLE_MS);
    // An idle browser is no reason to keep the process alive.
    this.#idleTimer.unref();
  }

  async #open(): Promise<BrowserContext> {
    if (this.#context !== undefined) {
      return this.#context;
    }
    // Stored before awaiting, so calls that arrive during the launch share it.
    this.#context = this.#launch();
    try {
      return await this.#context;
    } catch (error) {
      this.#context = undefined;
      throw error;
    }
  }

  async #launch(): Promise<BrowserContext> {
    const { dataDir, channel } = this.#options;
    await ensureDataDir(dataDir);
    const launch = this.#options.launch ?? launchContext;
    const context = await launch({
      profileDir: dataDir.profile,
      downloadsDir: dataDir.downloads,
      headless: true,
      channel,
    });
    context.on("close", () => {
      this.#context = undefined;
      this.#validated = undefined;
    });
    // A profile that lost its cookies, or a fresh one, starts from the export.
    if (!hasSessionCookie(await context.cookies([...SESSION_URLS]))) {
      const stored = await readStoredSession(dataDir.cookies);
      if (stored !== undefined) {
        await context.addCookies(stored.cookies);
      }
    }
    return context;
  }

  /**
   * Throws unless the auto-import, run at most once per process, left a session
   * that is still signed in. A later call finds the first one's outcome.
   */
  async #importOnce(context: BrowserContext): Promise<void> {
    const { autoImport } = this.#options;
    if (autoImport === undefined) {
      throw new AuthRequiredError();
    }
    this.#imported ??= autoImport((cookies) => this.#adopt(context, cookies));
    try {
      await this.#imported;
    } catch (error) {
      throw new AuthRequiredError(error instanceof Error ? error.message : String(error));
    }
    // Answered from the cache right after an import; a session imported
    // earlier may have lapsed since.
    if (!(await this.#isAuthenticated(context))) {
      throw new AuthRequiredError();
    }
  }

  async #adopt(context: BrowserContext, cookies: readonly StoredCookie[]): Promise<boolean> {
    await context.addCookies(cookies);
    this.#validated = undefined;
    if (await this.#isAuthenticated(context)) {
      return true;
    }
    // Cleared so the next candidate is judged on its own cookies alone.
    await context.clearCookies({ domain: SESSION_DOMAIN_PATTERN });
    return false;
  }

  async #isAuthenticated(context: BrowserContext): Promise<boolean> {
    const now = Date.now();
    if (this.#validated !== undefined && now - this.#validated.at < VALIDATION_TTL_MS) {
      return this.#validated.loggedIn;
    }
    const check = this.#options.checkLoggedIn ?? ((ctx) => checkLoggedIn(ctx.request));
    const loggedIn = await check(context);
    this.#validated = { at: now, loggedIn };
    if (loggedIn) {
      await exportSession(context, this.#options.dataDir, new Date(now));
    }
    return loggedIn;
  }
}

/** Refreshes `cookies.json` from a context whose session was just validated. */
export async function exportSession(
  context: BrowserContext,
  dataDir: DataDir,
  validatedAt: Readonly<Date>,
): Promise<void> {
  await writeStoredSession(dataDir.cookies, {
    validatedAt: validatedAt.toISOString(),
    cookies: authCookies(await context.cookies([...SESSION_URLS])),
  });
}
