import type { BrowserContext } from "playwright";

import { checkLoggedIn } from "../ankiweb/account.js";
import { type DataDir, ensureDataDir } from "../data-dir.js";
import { AuthRequiredError } from "./auth-required-error.js";
import {
  authCookies,
  hasSessionCookie,
  readStoredSession,
  SESSION_URLS,
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
}

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
        throw new AuthRequiredError();
      }
      return task(context);
    });
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
