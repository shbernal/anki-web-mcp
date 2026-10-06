import { existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { ToolError } from "./errors.js";

export const DATA_DIR_ENV = "ANKI_WEB_MCP_DATA_DIR";

const APP_DIR = "anki-web-mcp";
const LEGACY_DIR = ".anki-web-mcp";

const PRIVATE_DIR_MODE = 0o700;
const GROUP_OR_OTHER_BITS = 0o077;

/**
 * Everything the server keeps on disk. The session lives under `root`, which
 * only its owner can read; `downloads` is either inside it or, under the XDG
 * layout, in a directory of its own.
 */
export interface DataDir {
  /** Holds the session; checked and guarded as private. */
  readonly root: string;
  /** Playwright's persistent user-data dir. */
  readonly profile: string;
  /** Portable copy of the session cookies, refreshed on every validated login. */
  readonly cookies: string;
  /** Names the process using `profile`, while one is. */
  readonly profileLock: string;
  readonly downloads: string;
}

export class DataDirError extends ToolError {
  override name = "DataDirError";
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
  return { ...sessionPaths(state), downloads: join(data, "downloads") };
}

/** The spec says a relative path in an XDG variable is invalid and to be ignored. */
function xdgBase(value: string | undefined, fallback: string): string {
  return value !== undefined && isAbsolute(value) ? value : fallback;
}

function sessionPaths(root: string): Omit<DataDir, "downloads"> {
  return {
    root,
    profile: join(root, "profile"),
    cookies: join(root, "cookies.json"),
    profileLock: join(root, "profile.lock"),
  };
}

function underOneRoot(root: string): DataDir {
  return { ...sessionPaths(root), downloads: join(root, "downloads") };
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

/**
 * Creates the session root, private, and the downloads folder. Downloads hold
 * no secrets, so they are created private but never checked.
 */
export async function ensureDataDir(dir: DataDir): Promise<void> {
  if (!(await checkDataDir(dir.root))) {
    await mkdir(dir.root, { recursive: true, mode: PRIVATE_DIR_MODE });
    await checkDataDir(dir.root);
  }
  await mkdir(dir.downloads, { recursive: true, mode: PRIVATE_DIR_MODE });
}

/**
 * Deletes the stored session. Each target is checked to be a direct child of the
 * data dir, so a malformed `DataDir` can never point the recursive delete at
 * anything else.
 */
export async function removeSession(dir: DataDir): Promise<void> {
  if (!(await checkDataDir(dir.root))) {
    return;
  }
  for (const target of [dir.profile, dir.cookies]) {
    assertChildOf(dir.root, target);
    await rm(target, { recursive: true, force: true });
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
