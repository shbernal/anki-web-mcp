import { mkdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { ToolError } from "./errors.js";

export const DATA_DIR_ENV = "ANKI_WEB_MCP_DATA_DIR";

const PRIVATE_DIR_MODE = 0o700;
const GROUP_OR_OTHER_BITS = 0o077;

/** Everything the server keeps on disk, under one directory only its owner can read. */
export interface DataDir {
  readonly root: string;
  /** Playwright's persistent user-data dir. */
  readonly profile: string;
  /** Portable copy of the session cookies, refreshed on every validated login. */
  readonly cookies: string;
  readonly downloads: string;
}

export class DataDirError extends ToolError {
  override name = "DataDirError";
}

export function resolveDataDir(
  flag: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): DataDir {
  const root = resolve(flag ?? env[DATA_DIR_ENV] ?? join(homedir(), ".anki-web-mcp"));
  return {
    root,
    profile: join(root, "profile"),
    cookies: join(root, "cookies.json"),
    downloads: join(root, "downloads"),
  };
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
