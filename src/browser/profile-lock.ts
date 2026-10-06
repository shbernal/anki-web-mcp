import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";

import { z } from "zod";

import { type AccountPaths, unlessMissing } from "../data-dir.js";
import { ToolError } from "../errors.js";

const PRIVATE_FILE_MODE = 0o600;

/**
 * Who holds the profile. Chromium's own `SingletonLock` cannot say: Playwright's
 * headless shell never writes one, and a second launch on a profile already in
 * use goes through, leaving two browsers writing the same cookie store.
 */
export type ProfileHolder = "server" | "login" | "import";

const lockSchema = z
  .object({
    pid: z.number().int(),
    holder: z.enum(["server", "login", "import"]),
    token: z.string(),
  })
  .readonly();

type LockFile = z.infer<typeof lockSchema>;

const ADVICE: Readonly<Record<ProfileHolder, string>> = {
  server:
    "The running server's browser has it: ask the assistant to call `close_session`, or wait five idle minutes for it to close by itself, then try again.",
  login:
    "`anki-web-mcp --login` has it open: finish signing in or close its window, then try again.",
  import: "`anki-web-mcp --import-from-browser` has it: let it finish, then try again.",
};

export class ProfileInUseError extends ToolError {
  override name = "ProfileInUseError";
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM is a live process owned by someone else; only ESRCH means gone.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

async function readLock(path: string): Promise<LockFile | undefined> {
  const text = await unlessMissing(readFile(path, "utf8"));
  if (text === undefined) {
    return undefined;
  }
  try {
    const parsed = lockSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    // A lock half written by a process that died mid-write holds nobody.
    return undefined;
  }
}

/** The lock's holder when another live process has it, so the profile must be left alone. */
async function liveHolder(path: string): Promise<LockFile | undefined> {
  const lock = await readLock(path);
  return lock !== undefined && lock.pid !== process.pid && isRunning(lock.pid) ? lock : undefined;
}

function inUse(lock: LockFile, profile: string): ProfileInUseError {
  return new ProfileInUseError(
    `The browser profile in ${profile} is in use by process ${lock.pid}. ${ADVICE[lock.holder]}`,
  );
}

/** The two paths the lock is about: the profile, and the file naming who has it. */
export type LockedPaths = Readonly<Pick<AccountPaths, "profile" | "profileLock">>;

/** Throws when another live process holds the profile. */
export async function assertProfileFree({ profile, profileLock }: LockedPaths): Promise<void> {
  const lock = await liveHolder(profileLock);
  if (lock !== undefined) {
    throw inUse(lock, profile);
  }
}

/**
 * Takes the profile for this process, and resolves to the function that gives
 * it back. A lock left by a process that is gone is taken over. Releasing only
 * removes the file while it is still this call's, so a late release never
 * frees a lock taken since.
 */
export async function lockProfile(
  paths: LockedPaths,
  holder: ProfileHolder,
): Promise<() => Promise<void>> {
  const lockPath = paths.profileLock;
  const lock: LockFile = { pid: process.pid, holder, token: randomUUID() };
  const text = `${JSON.stringify(lock)}\n`;
  try {
    await writeFile(lockPath, text, { flag: "wx", mode: PRIVATE_FILE_MODE });
  } catch (error) {
    if (errorCode(error) !== "EEXIST") {
      throw error;
    }
    await assertProfileFree(paths);
    await writeFile(lockPath, text, { mode: PRIVATE_FILE_MODE });
  }
  // Shared, so every caller of the release waits on the one removal.
  let released: Promise<void> | undefined = undefined;
  return async () => {
    released ??= removeIfHeld(lockPath, lock.token);
    await released;
  };
}

async function removeIfHeld(lockPath: string, token: string): Promise<void> {
  const current = await readLock(lockPath);
  if (current?.token === token) {
    await rm(lockPath, { force: true });
  }
}

/**
 * Runs `open` holding the profile, and resolves to what it opened along with
 * the function that gives the profile back. If `open` fails, the profile is
 * given back before the error goes on.
 */
export async function openLocked<Opened>(
  paths: LockedPaths,
  holder: ProfileHolder,
  open: () => Promise<Opened>,
): Promise<[Opened, () => Promise<void>]> {
  const unlock = await lockProfile(paths, holder);
  try {
    return [await open(), unlock];
  } catch (error) {
    await unlock();
    throw error;
  }
}
