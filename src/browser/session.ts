import type { BrowserContext } from "playwright";

import { checkLoggedIn } from "../ankiweb/account.js";
import type { Fetch } from "../ankiweb/response-cache.js";
import { type AccountPaths, type DataDir, ensureAccount } from "../data-dir.js";
import { AuthRequiredError } from "./auth-required-error.js";
import {
  checkStoredSession,
  exportSession,
  hasSessionCookie,
  readStoredSession,
  sessionCookieHeader,
  SESSION_DOMAIN_PATTERN,
  SESSION_URLS,
  type StoredCookie,
} from "./cookies.js";
import { launchContext, type LaunchOptions } from "./launch.js";
import { openLocked, type ProfileHolder } from "./profile-lock.js";

/** Five minutes. */
const DEFAULT_IDLE_MS = 300_000;
/** Long enough that one tool call validating more than once costs one request. */
const VALIDATION_TTL_MS = 30_000;

export interface SessionOptions {
  readonly dataDir: DataDir;
  /** Which of `dataDir`'s sessions this browser signs in with. */
  readonly account: AccountPaths;
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
  /** Sends `checkSignedIn`'s request when there is no browser to send it; replaced in tests. */
  readonly fetch?: Fetch;
  /** Who the profile lock names while the browser is open; `server` by default. */
  readonly holder?: ProfileHolder;
}

/** Resolves to whether AnkiWeb accepted the cookies, which are kept only if it did. */
export type AdoptCookies = (cookies: readonly StoredCookie[]) => Promise<boolean>;

/**
 * The server's one browser. The first call launches a headless persistent
 * context, later calls share it, and it closes after `idleMs` with nothing in
 * flight. It never opens a headed window: a stdio client may have no display,
 * so signing in is left to `--login`.
 *
 * Calls take turns: each waits for the one before it to finish, so a session
 * check, an import or a share never interleaves with another call on the same
 * cookie jar. A task must not call `use` again, or it waits on itself.
 */
export class BrowserSession {
  readonly account: AccountPaths;
  readonly #options: SessionOptions;
  #context: Promise<BrowserContext> | undefined;
  #active = 0;
  #idleTimer: NodeJS.Timeout | undefined;
  #validated: { readonly at: number; readonly loggedIn: boolean } | undefined;
  #imported: Promise<unknown> | undefined;
  #unlock: (() => Promise<void>) | undefined;
  /** Settles when the last call queued so far has finished. */
  #queue: Promise<void> = Promise.resolve();

  constructor(options: SessionOptions) {
    this.#options = options;
    this.account = options.account;
  }

  /** When a session check last succeeded in this process, if one has. */
  get lastValidatedAt(): Date | undefined {
    return this.#validated?.loggedIn === true ? new Date(this.#validated.at) : undefined;
  }

  async use<Result>(task: (context: BrowserContext) => Promise<Result>): Promise<Result> {
    this.#active += 1;
    clearTimeout(this.#idleTimer);
    try {
      return await this.#exclusive(async () => task(await this.#open()));
    } finally {
      this.#active -= 1;
      this.#armIdleTimer();
    }
  }

  async useAuthenticated<Result>(
    task: (context: BrowserContext) => Promise<Result>,
  ): Promise<Result> {
    try {
      return await this.use(async (context) => {
        if (!(await this.#isAuthenticated(context))) {
          await this.#importOnce(context);
        }
        return task(context);
      });
    } catch (error) {
      // Thrown deep in a request too, where nobody knows which account it was.
      throw error instanceof AuthRequiredError
        ? new AuthRequiredError(error.importFailure, this.account.name)
        : error;
    }
  }

  /**
   * A `Cookie` header carrying the signed-in session, for a request sent
   * outside the browser, such as a download streamed straight to disk.
   */
  async sessionCookie(): Promise<string> {
    const header = await this.useAuthenticated(async (context) =>
      sessionCookieHeader(await context.cookies([...SESSION_URLS])),
    );
    if (header === undefined) {
      throw new AuthRequiredError("", this.account.name);
    }
    return header;
  }

  adoptCookies(cookies: readonly StoredCookie[]): Promise<boolean> {
    return this.use((context) => this.#adopt(context, cookies));
  }

  isAuthenticated(): Promise<boolean> {
    return this.use((context) => this.#isAuthenticated(context));
  }

  /**
   * Whether the session is signed in, without launching a browser when the
   * stored cookie can answer. A browser already open is asked as usual. A
   * stored cookie that AnkiWeb turns down is not the last word, since the
   * profile may hold a newer one, so the browser is asked then too.
   */
  async checkSignedIn(): Promise<boolean> {
    const signedIn = await this.#exclusive(() =>
      this.#context === undefined
        ? checkStoredSession(this.#options.account.cookies, this.#options.fetch ?? fetch)
        : Promise.resolve(false),
    );
    return signedIn || this.isAuthenticated();
  }

  /**
   * Closes the browser once the calls ahead of this one have finished, and
   * resolves to whether one was open. The next call relaunches it.
   */
  release(): Promise<boolean> {
    return this.#exclusive(async () => {
      const open = this.#context !== undefined;
      await this.close();
      return open;
    });
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
    await this.#unlock?.();
  }

  /** Runs `task` after every call queued before it, whether those succeeded or not. */
  #exclusive<Result>(task: () => Promise<Result>): Promise<Result> {
    const turn = runAfter(this.#queue, task);
    this.#queue = settled(turn);
    return turn;
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
    const { dataDir, account, channel } = this.#options;
    await ensureAccount(dataDir, account);
    const launch = this.#options.launch ?? launchContext;
    const [context, unlock] = await openLocked(account, this.#options.holder ?? "server", () =>
      launch({
        profileDir: account.profile,
        downloadsDir: dataDir.downloads,
        headless: true,
        channel,
      }),
    );
    this.#unlock = unlock;
    context.on("close", () => {
      this.#context = undefined;
      this.#validated = undefined;
      // A browser that exits on its own, such as on a crash, frees the profile too.
      void unlock();
    });
    // A profile that lost its cookies, or a fresh one, starts from the export.
    if (!hasSessionCookie(await context.cookies([...SESSION_URLS]))) {
      const stored = await readStoredSession(account.cookies);
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
      await exportSession(context, this.#options.account.cookies, new Date(now));
    }
    return loggedIn;
  }
}

async function runAfter<Result>(
  previous: Promise<void>,
  task: () => Promise<Result>,
): Promise<Result> {
  await previous;
  return task();
}

/** Resolves once `turn` settles either way. */
async function settled(turn: Promise<unknown>): Promise<void> {
  try {
    await turn;
  } catch {
    // The call that queued `turn` gets its error; the next one only waits.
  }
}
