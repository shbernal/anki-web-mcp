import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lockProfile } from "../src/browser/profile-lock.js";
import {
  DataDirError,
  accountPaths,
  DEFAULT_ACCOUNT,
  ensureAccount,
  ensureDataDir,
  listAccounts,
  removeSession,
  resolveDataDir,
} from "../src/data-dir.js";

const PERMISSION_BITS = 0o777;

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("accountPaths", () => {
  const dir = { root: "/data", downloads: "/data/downloads" };

  it("keeps the default account at the root", () => {
    expect.assertions(1);
    expect(accountPaths(dir, DEFAULT_ACCOUNT)).toStrictEqual({
      name: "default",
      dir: "/data",
      profile: "/data/profile",
      cookies: "/data/cookies.json",
      profileLock: "/data/profile.lock",
    });
  });

  it("keeps a named account under accounts/", () => {
    expect.assertions(1);
    expect(accountPaths(dir, "work")).toStrictEqual({
      name: "work",
      dir: "/data/accounts/work",
      profile: "/data/accounts/work/profile",
      cookies: "/data/accounts/work/cookies.json",
      profileLock: "/data/accounts/work/profile.lock",
    });
  });

  it("refuses a name outside the rule, stating it", () => {
    expect.assertions(5);
    for (const name of ["", "Work", "-work", "../work", "a".repeat(33)]) {
      expect(() => accountPaths(dir, name)).toThrow(DataDirError);
    }
  });

  it("accepts digits, dashes and underscores after the first character", () => {
    expect.assertions(1);
    expect(accountPaths(dir, `0a_-${"b".repeat(28)}`).name).toHaveLength(32);
  });
});

describe("ensureAccount", () => {
  it("creates no accounts/ for the default account", async () => {
    expect.assertions(1);
    const dir = resolveDataDir(join(scratch, "data"));
    await ensureAccount(dir, accountPaths(dir, DEFAULT_ACCOUNT));
    await expect(readdir(dir.root)).resolves.toStrictEqual(["downloads"]);
  });

  it("creates a named account's directory and accounts/, both private", async () => {
    expect.assertions(2);
    const dir = resolveDataDir(join(scratch, "data"));
    const work = accountPaths(dir, "work");
    await ensureAccount(dir, work);
    const accounts = await stat(join(dir.root, "accounts"));
    const own = await stat(work.dir);
    expect(accounts.mode & PERMISSION_BITS).toBe(0o700);
    expect(own.mode & PERMISSION_BITS).toBe(0o700);
  });

  it("refuses an account directory others can read", async () => {
    expect.assertions(1);
    const dir = resolveDataDir(join(scratch, "data"));
    const work = accountPaths(dir, "work");
    await ensureAccount(dir, work);
    await chmod(work.dir, 0o755);
    await expect(ensureAccount(dir, work)).rejects.toThrow(/chmod 700/u);
  });
});

describe("listAccounts", () => {
  it("lists nothing without a data dir, or with one that holds no session", async () => {
    expect.assertions(2);
    const dir = resolveDataDir(join(scratch, "data"));
    await expect(listAccounts(dir)).resolves.toStrictEqual([]);
    await ensureDataDir(dir);
    await expect(listAccounts(dir)).resolves.toStrictEqual([]);
  });

  it("lists the default account once its root holds a session", async () => {
    expect.assertions(1);
    const dir = resolveDataDir(join(scratch, "data"));
    await ensureDataDir(dir);
    await writeFile(accountPaths(dir, DEFAULT_ACCOUNT).cookies, "{}");
    await expect(listAccounts(dir)).resolves.toStrictEqual(["default"]);
  });

  it("lists default first, then named accounts sorted, ignoring anything else", async () => {
    expect.assertions(2);
    const dir = resolveDataDir(join(scratch, "data"));
    await ensureDataDir(dir);
    await mkdir(accountPaths(dir, DEFAULT_ACCOUNT).profile);
    for (const name of ["work", "home"]) {
      await ensureAccount(dir, accountPaths(dir, name));
    }
    const accounts = join(dir.root, "accounts");
    await mkdir(join(accounts, "Bad Name"));
    await mkdir(join(accounts, "default"));
    await writeFile(join(accounts, "file"), "");
    await expect(listAccounts(dir)).resolves.toStrictEqual(["default", "home", "work"]);
    await expect(readdir(accounts)).resolves.toHaveLength(5);
  });
});

describe("profile locks", () => {
  it("lets two accounts hold their profiles at once", async () => {
    expect.assertions(1);
    const dir = resolveDataDir(join(scratch, "data"));
    const work = accountPaths(dir, "work");
    const home = accountPaths(dir, "home");
    await ensureAccount(dir, work);
    await ensureAccount(dir, home);
    // Another live process has one account's profile; the other's is still free.
    await writeFile(
      work.profileLock,
      JSON.stringify({ pid: process.ppid, holder: "server", token: "theirs" }),
    );
    const unlock = await lockProfile(home, "server");
    await unlock();
    await expect(lockProfile(work, "server")).rejects.toThrow(/in use/u);
  });
});

describe("removing a named account", () => {
  it("removes a named account and leaves the others and the downloads", async () => {
    expect.assertions(2);
    const dir = resolveDataDir(join(scratch, "data"));
    const work = accountPaths(dir, "work");
    const home = accountPaths(dir, "home");
    for (const account of [work, home]) {
      await ensureAccount(dir, account);
      await writeFile(account.cookies, "{}");
    }
    await writeFile(work.profileLock, "{}");
    await removeSession(dir, work);
    await expect(listAccounts(dir)).resolves.toStrictEqual(["home"]);
    await expect(readdir(dir.root)).resolves.toStrictEqual(["accounts", "downloads"]);
  });

  it("keeps a named account's directory holding something else", async () => {
    expect.assertions(1);
    const dir = resolveDataDir(join(scratch, "data"));
    const work = accountPaths(dir, "work");
    await ensureAccount(dir, work);
    await writeFile(join(work.dir, "notes.txt"), "");
    await removeSession(dir, work);
    await expect(readdir(work.dir)).resolves.toStrictEqual(["notes.txt"]);
  });
});
