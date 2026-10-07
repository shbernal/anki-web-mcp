import {
  type AccountPaths,
  accountPaths,
  type DataDir,
  DEFAULT_ACCOUNT,
  listAccounts,
  loginCommand,
} from "../data-dir.js";
import { ToolError } from "../errors.js";
import { BrowserSession, type SessionOptions } from "./session.js";

export interface AccountsOptions {
  readonly dataDir: DataDir;
  /** The account a call uses when it names none: `--account`, or `default`. */
  readonly fallback?: string;
  /**
   * What every account's session is built with. `autoImport` is kept for the
   * default account alone: a local browser's session could be anybody's, and
   * the default account is the one that held it before accounts had names.
   */
  readonly session?: Omit<SessionOptions, "dataDir" | "account">;
}

/**
 * The server's sessions, one per account and each with its own browser, queue,
 * idle timer and profile lock, so two accounts never share a cookie jar or wait
 * on each other.
 */
export class Accounts {
  readonly dataDir: DataDir;
  readonly fallback: string;
  readonly #defaults: Omit<SessionOptions, "dataDir" | "account">;
  readonly #sessions = new Map<string, BrowserSession>();

  constructor({ dataDir, fallback = DEFAULT_ACCOUNT, session = {} }: AccountsOptions) {
    this.dataDir = dataDir;
    this.fallback = fallback;
    this.#defaults = session;
  }

  /** The accounts stored on disk, `default` first. */
  list(): Promise<string[]> {
    return listAccounts(this.dataDir);
  }

  /**
   * The session for `name`, or for the fallback when a call names none. The
   * default account is always there to sign in, as it was before accounts had
   * names; any other must already be on disk, since a tool call never creates
   * one. Checked on every call, so an account signed out since is refused.
   */
  async session(name: string | undefined): Promise<BrowserSession> {
    const wanted = name ?? this.fallback;
    if (wanted !== DEFAULT_ACCOUNT) {
      const known = await this.list();
      if (!known.includes(wanted)) {
        throw new ToolError(
          `No AnkiWeb account named "${wanted}". Accounts: ${known.join(", ") || "none"}. Add one with \`${loginCommand(wanted)}\` in a terminal.`,
        );
      }
    }
    const existing = this.#sessions.get(wanted);
    if (existing !== undefined) {
      return existing;
    }
    const session = this.#open(accountPaths(this.dataDir, wanted));
    this.#sessions.set(wanted, session);
    return session;
  }

  #open(account: AccountPaths): BrowserSession {
    const { autoImport, ...rest } = this.#defaults;
    return new BrowserSession({
      ...rest,
      dataDir: this.dataDir,
      account,
      autoImport: account.name === DEFAULT_ACCOUNT ? autoImport : undefined,
    });
  }

  /** Every session built so far. */
  opened(): BrowserSession[] {
    return [...this.#sessions.values()];
  }

  async close(): Promise<void> {
    await Promise.all(this.opened().map((session) => session.close()));
  }
}
