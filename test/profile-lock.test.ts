import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { logout } from "../src/browser/login.js";
import { lockProfile, ProfileInUseError } from "../src/browser/profile-lock.js";
import { BrowserSession } from "../src/browser/session.js";
import { type DataDir, ensureDataDir, resolveDataDir } from "../src/data-dir.js";
import { fakeContext } from "./fake-context.js";

/** Above any Linux or macOS pid limit, so never a running process. */
const DEAD_PID = 2 ** 30;

let scratch: string;
let dataDir: DataDir;

/** Writes the lock as another process would have left it. */
async function heldBy(pid: number, holder: string): Promise<void> {
  await writeFile(dataDir.profileLock, JSON.stringify({ pid, holder, token: "theirs" }));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-"));
  dataDir = resolveDataDir(join(scratch, "data"));
  await ensureDataDir(dataDir);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("profile lock", () => {
  it("names this process while held and is gone once released", async () => {
    expect.assertions(2);
    const unlock = await lockProfile(dataDir, "login");
    const lock: unknown = JSON.parse(await readFile(dataDir.profileLock, "utf8"));
    expect(lock).toMatchObject({ pid: process.pid, holder: "login" });
    await unlock();
    await expect(exists(dataDir.profileLock)).resolves.toBe(false);
  });

  it("refuses a profile another live process holds, and says how to free it", async () => {
    expect.assertions(2);
    await heldBy(process.ppid, "server");
    const failure = lockProfile(dataDir, "login");
    await expect(failure).rejects.toThrow(ProfileInUseError);
    await expect(failure).rejects.toThrow(/process \d+.*close_session/u);
  });

  it("takes over a lock left by a process that is gone", async () => {
    expect.assertions(1);
    await heldBy(DEAD_PID, "server");
    const unlock = await lockProfile(dataDir, "login");
    const lock: unknown = JSON.parse(await readFile(dataDir.profileLock, "utf8"));
    expect(lock).toMatchObject({ pid: process.pid });
    await unlock();
  });

  it("takes over a lock that is not valid JSON", async () => {
    expect.assertions(1);
    await writeFile(dataDir.profileLock, "{");
    await expect(lockProfile(dataDir, "login")).resolves.toBeTypeOf("function");
  });

  it("leaves a lock taken since alone on a late release", async () => {
    expect.assertions(1);
    const first = await lockProfile(dataDir, "server");
    const second = await lockProfile(dataDir, "server");
    await first();
    await expect(exists(dataDir.profileLock)).resolves.toBe(true);
    await second();
  });
});

describe("browser session and the lock", () => {
  it("does not launch on a profile another process holds", async () => {
    expect.assertions(2);
    await heldBy(process.ppid, "login");
    let launched = false;
    const session = new BrowserSession({
      dataDir,
      launch: async () => {
        launched = true;
        return fakeContext().context;
      },
    });
    await expect(session.use(async () => "ran")).rejects.toThrow(/--login/u);
    expect(launched).toBe(false);
  });

  it("holds the profile while the browser is open", async () => {
    expect.assertions(2);
    const session = new BrowserSession({ dataDir, launch: async () => fakeContext().context });
    await session.use(async () => "ran");
    await expect(exists(dataDir.profileLock)).resolves.toBe(true);
    await session.close();
    await expect(exists(dataDir.profileLock)).resolves.toBe(false);
  });

  it("gives the profile back when the launch fails", async () => {
    expect.assertions(2);
    const session = new BrowserSession({
      dataDir,
      launch: async () => {
        throw new Error("no browser");
      },
    });
    await expect(session.use(async () => "ran")).rejects.toThrow("no browser");
    await expect(exists(dataDir.profileLock)).resolves.toBe(false);
  });
});

describe("logout", () => {
  it("keeps the session while another process has the profile open", async () => {
    expect.assertions(2);
    await mkdir(dataDir.profile);
    await heldBy(process.ppid, "server");
    await expect(logout(dataDir)).rejects.toThrow(ProfileInUseError);
    await expect(exists(dataDir.profile)).resolves.toBe(true);
  });
});
