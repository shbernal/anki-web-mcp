import { existsSync } from "node:fs";
import { mkdir, readdir, rm, rmdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { ToolError } from "./errors.js";

export const DATA_DIR_ENV = "ANKI_WEB_MCP_DATA_DIR";

const APP_DIR = "anki-web-mcp";
const LEGACY_DIR = ".anki-web-mcp";

const ACCOUNTS_DIR = "accounts";

/** The account kept at the root, which is every session stored before accounts had names. */
export const DEFAULT_ACCOUNT = "default";
const ACCOUNT_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/u;

const PRIVATE_DIR_MODE = 0o700;
const GROUP_OR_OTHER_BITS = 0o077;

/**
 * Everything the server keeps on disk. The sessions live under `root`, which
 * only its owner can read; `downloads` is either inside it or, under the XDG
 * layout, in a directory of its own, and every account shares it.
 */
export interface DataDir {
  /** Holds the default account's session and `accounts/`; checked and guarded as private. */
  readonly root: string;
  readonly downloads: string;
}

/**
 * One AnkiWeb session. The default account's files sit at the data dir's root,
 * and a named one's under `accounts/<name>/`. The name is the user's label: no
 * AnkiWeb endpoint we know of names the signed-in user.
 */
export interface AccountPaths {
  readonly name: string;
  /** Holds this account's files; checked and guarded as private. */
  readonly dir: string;
  /** Playwright's persistent user-data dir. */
  readonly profile: string;
  /** Portable copy of the session cookies, refreshed on every validated login. */
  readonly cookies: string;
  /** Names the process using `profile`, while one is. */
  readonly profileLock: string;
}

export class DataDirError extends ToolError {
  override name = "DataDirError";
}

export function isAccountName(name: string): boolean {
  return ACCOUNT_NAME.test(name);
}

/** Throws unless `name` can name an account. */
export function assertAccountName(name: string): void {
  if (!isAccountName(name)) {
    throw new DataDirError(
      `${JSON.stringify(name)} is not an account name: use 1 to 32 lowercase letters, digits, \`-\` or \`_\`, starting with a letter or digit`,
    );
  }
}

/** What `resolveDataDir` reads from the machine, replaced in tests. */
export interface Host {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly home?: string;
  readonly exists?: (path: string) => boolean;
}

/**
 * `--data-dir`, then `ANKI_WEB_MCP_DATA_DIR`, keep everything under one root.
 * Otherwise Linux follows the XDG base directory spec, keeping the session in
 * the state dir and downloads in the data dir, unless a `~/.anki-web-mcp` from
 * before that layout is there and the state dir is not. Every other platform
 * uses `~/.anki-web-mcp`.
 */
export function resolveDataDir(flag: string | undefined, host: Host = {}): DataDir {
  const {
    env = process.env,
    platform = process.platform,
    home = homedir(),
    exists = existsSync,
  } = host;
  const explicit = flag ?? env[DATA_DIR_ENV];
  if (explicit !== undefined) {
    return underOneRoot(resolve(explicit));
  }
  const legacy = join(home, LEGACY_DIR);
  if (platform !== "linux") {
    return underOneRoot(legacy);
  }
  const state = join(xdgBase(env.XDG_STATE_HOME, join(home, ".local", "state")), APP_DIR);
  if (!exists(state) && exists(legacy)) {
    return underOneRoot(legacy);
  }
  const data = join(xdgBase(env.XDG_DATA_HOME, join(home, ".local", "share")), APP_DIR);
  return { root: state, downloads: join(data, "downloads") };
}

/** The spec says a relative path in an XDG variable is invalid and to be ignored. */
function xdgBase(value: string | undefined, fallback: string): string {
  return value !== undefined && isAbsolute(value) ? value : fallback;
}

function underOneRoot(root: string): DataDir {
  return { root, downloads: join(root, "downloads") };
}

function accountsDir(dir: DataDir): string {
  return join(dir.root, ACCOUNTS_DIR);
}

/** Where `name`'s session is kept. Throws on a name that cannot be one. */
export function accountPaths(dir: DataDir, name: string): AccountPaths {
  assertAccountName(name);
  const accountDir = name === DEFAULT_ACCOUNT ? dir.root : join(accountsDir(dir), name);
  return {
    name,
    dir: accountDir,
    profile: join(accountDir, "profile"),
    cookies: join(accountDir, "cookies.json"),
    profileLock: join(accountDir, "profile.lock"),
  };
}

/**
 * The accounts stored in `dir`, `default` first and the rest sorted. The
 * default account is listed once its root holds a profile or a cookie export,
 * and a named one for each validly named directory under `accounts/`. Anything
 * else there is ignored, and left alone.
 */
export async function listAccounts(dir: DataDir): Promise<string[]> {
  if (!(await checkDataDir(dir.root))) {
    return [];
  }
  const root = accountPaths(dir, DEFAULT_ACCOUNT);
  const hasDefault = existsSync(root.profile) || existsSync(root.cookies);
  const named = (await checkDataDir(accountsDir(dir))) ? await namedAccounts(accountsDir(dir)) : [];
  return hasDefault ? [DEFAULT_ACCOUNT, ...named] : named;
}

async function namedAccounts(accounts: string): Promise<string[]> {
  const names: string[] = [];
  for (const entry of await readdir(accounts, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== DEFAULT_ACCOUNT && isAccountName(entry.name)) {
      names.push(entry.name);
    }
  }
  return names.toSorted();
}

/**
 * Throws unless `root` is a directory the current user owns and nobody else can
 * read, the same rule `ssh` applies to `~/.ssh`. Returns false when it does not
 * exist yet.
 */
export async function checkDataDir(root: string): Promise<boolean> {
  const stats = await unlessMissing(stat(root));
  if (stats === undefined) {
    return false;
  }
  if (!stats.isDirectory()) {
    throw new DataDirError(`${root} is not a directory`);
  }
  // Windows reports neither owners nor POSIX modes, so there is nothing to check.
  if (process.platform === "win32") {
    return true;
  }
  if (stats.uid !== process.getuid?.()) {
    throw new DataDirError(`${root} is owned by another user; refusing to use it`);
  }
  if ((stats.mode & GROUP_OR_OTHER_BITS) !== 0) {
    throw new DataDirError(
      `${root} is accessible to other users; run \`chmod 700 ${root}\` and try again`,
    );
  }
  return true;
}

async function ensurePrivateDir(path: string): Promise<void> {
  if (!(await checkDataDir(path))) {
    await mkdir(path, { recursive: true, mode: PRIVATE_DIR_MODE });
    await checkDataDir(path);
  }
}

/**
 * Creates the session root, private, and the downloads folder. Downloads hold
 * no secrets, so they are created private but never checked.
 */
export async function ensureDataDir(dir: DataDir): Promise<void> {
  await ensurePrivateDir(dir.root);
  await mkdir(dir.downloads, { recursive: true, mode: PRIVATE_DIR_MODE });
}

/**
 * `ensureDataDir`, and for a named account its directory and `accounts/`, both
 * private. The default account needs nothing more, so a single-account user
 * never gets an `accounts/`.
 */
export async function ensureAccount(dir: DataDir, account: AccountPaths): Promise<void> {
  await ensureDataDir(dir);
  if (account.dir !== dir.root) {
    await ensurePrivateDir(accountsDir(dir));
    await ensurePrivateDir(account.dir);
  }
}

/**
 * Deletes an account's stored session, and a named account's directory with
 * it. Each target is checked to be a direct child of the account's directory,
 * so a malformed `AccountPaths` can never point the recursive delete at
 * anything else. Downloads, shared by every account, are kept.
 */
export async function removeSession(dir: DataDir, account: AccountPaths): Promise<void> {
  if (!(await checkDataDir(account.dir))) {
    return;
  }
  const named = account.dir !== dir.root;
  // Only called once the profile is known to be free, so a lock left is stale.
  const targets = named
    ? [account.profile, account.cookies, account.profileLock]
    : [account.profile, account.cookies];
  for (const target of targets) {
    assertChildOf(account.dir, target);
    await rm(target, { recursive: true, force: true });
  }
  if (named) {
    assertChildOf(accountsDir(dir), account.dir);
    await removeIfEmpty(account.dir);
  }
}

/** Anything the user put in the directory keeps it, and them, where they are. */
async function removeIfEmpty(path: string): Promise<void> {
  try {
    await rmdir(path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOTEMPTY")) {
      throw error;
    }
  }
}

export function assertChildOf(root: string, target: string): void {
  const resolved = resolve(target);
  const name = basename(resolved);
  if (dirname(resolved) !== resolve(root) || name === "" || name === "." || name === "..") {
    throw new DataDirError(`${target} is not inside ${root}; refusing to delete it`);
  }
}

/** Resolves to `undefined` instead of rejecting when the path does not exist. */
export async function unlessMissing<Result>(
  operation: Promise<Result>,
): Promise<Result | undefined> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
