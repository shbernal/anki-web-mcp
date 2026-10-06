import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  accountPaths,
  assertChildOf,
  checkDataDir,
  DataDirError,
  DEFAULT_ACCOUNT,
  ensureDataDir,
  removeSession,
  resolveDataDir,
} from "../src/data-dir.js";

const PERMISSION_BITS = 0o777;
const HOME = "/home/u";

function nothing(): boolean {
  return false;
}

function legacyOnly(path: string): boolean {
  return path === `${HOME}/.anki-web-mcp`;
}

function legacyAndState(path: string): boolean {
  return path.endsWith("anki-web-mcp");
}

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("resolveDataDir", () => {
  const linux = { platform: "linux", home: HOME, exists: nothing, env: {} } as const;

  it("prefers the flag, then the environment, each keeping everything under one root", () => {
    expect.assertions(3);
    const env = { ANKI_WEB_MCP_DATA_DIR: "/from/env" };
    expect(resolveDataDir("/from/flag", { ...linux, env }).root).toBe("/from/flag");
    expect(resolveDataDir(undefined, { ...linux, env })).toStrictEqual({
      root: "/from/env",
      downloads: "/from/env/downloads",
    });
    expect(resolveDataDir(undefined, {}).root).toMatch(/anki-web-mcp$/u);
  });

  it("keeps the session in the XDG state dir and downloads in the data dir on Linux", () => {
    expect.assertions(1);
    expect(resolveDataDir(undefined, linux)).toStrictEqual({
      root: "/home/u/.local/state/anki-web-mcp",
      downloads: "/home/u/.local/share/anki-web-mcp/downloads",
    });
  });

  it("follows XDG_STATE_HOME and XDG_DATA_HOME, ignoring relative or empty ones", () => {
    expect.assertions(3);
    const env = { XDG_STATE_HOME: "/xdg/state", XDG_DATA_HOME: "/xdg/data" };
    const set = resolveDataDir(undefined, { ...linux, env });
    expect(set.root).toBe("/xdg/state/anki-web-mcp");
    expect(set.downloads).toBe("/xdg/data/anki-web-mcp/downloads");
    const ignored = { XDG_STATE_HOME: "relative/state", XDG_DATA_HOME: "" };
    expect(resolveDataDir(undefined, { ...linux, env: ignored })).toStrictEqual(
      resolveDataDir(undefined, linux),
    );
  });

  it("keeps using ~/.anki-web-mcp on Linux until the state dir exists", () => {
    expect.assertions(2);
    expect(resolveDataDir(undefined, { ...linux, exists: legacyOnly }).downloads).toBe(
      "/home/u/.anki-web-mcp/downloads",
    );
    expect(resolveDataDir(undefined, { ...linux, exists: legacyAndState }).root).toBe(
      "/home/u/.local/state/anki-web-mcp",
    );
  });

  it("uses ~/.anki-web-mcp everywhere else, whatever XDG says", () => {
    expect.assertions(1);
    const env = { XDG_STATE_HOME: "/xdg/state" };
    expect(resolveDataDir(undefined, { ...linux, platform: "darwin", env }).root).toBe(
      "/home/u/.anki-web-mcp",
    );
  });
});

describe("checkDataDir", () => {
  it("reports a missing directory as absent", async () => {
    expect.assertions(1);
    await expect(checkDataDir(join(scratch, "missing"))).resolves.toBe(false);
  });

  it("refuses a directory other users can read", async () => {
    expect.assertions(1);
    await chmod(scratch, 0o755);
    await expect(checkDataDir(scratch)).rejects.toThrow(/chmod 700/u);
  });

  it("refuses a file", async () => {
    expect.assertions(1);
    const file = join(scratch, "file");
    await writeFile(file, "");
    await expect(checkDataDir(file)).rejects.toThrow(DataDirError);
  });
});

describe("ensureDataDir", () => {
  it("creates the directory private to its owner, with a downloads folder", async () => {
    expect.assertions(2);
    const dir = resolveDataDir(join(scratch, "data"));
    await ensureDataDir(dir);
    const root = await stat(dir.root);
    const downloads = await stat(dir.downloads);
    expect(root.mode & PERMISSION_BITS).toBe(0o700);
    expect(downloads.isDirectory()).toBe(true);
  });

  it("creates a downloads folder that lives outside the session root", async () => {
    expect.assertions(2);
    const dir = resolveDataDir(undefined, {
      platform: "linux",
      home: scratch,
      env: {},
      exists: nothing,
    });
    await ensureDataDir(dir);
    const root = await stat(dir.root);
    const downloads = await stat(dir.downloads);
    expect(root.mode & PERMISSION_BITS).toBe(0o700);
    expect(downloads.isDirectory()).toBe(true);
  });
});

describe("removeSession", () => {
  it("deletes the profile and the cookie export and keeps downloads", async () => {
    expect.assertions(1);
    const dir = resolveDataDir(join(scratch, "data"));
    const account = accountPaths(dir, DEFAULT_ACCOUNT);
    await ensureDataDir(dir);
    await mkdir(account.profile);
    await writeFile(join(account.profile, "Cookies"), "");
    await writeFile(account.cookies, "{}");
    await removeSession(dir, account);
    await expect(readdir(dir.root)).resolves.toStrictEqual(["downloads"]);
  });

  it("does nothing when there is no data dir", async () => {
    expect.assertions(1);
    const missing = resolveDataDir(join(scratch, "missing"));
    await expect(
      removeSession(missing, accountPaths(missing, DEFAULT_ACCOUNT)),
    ).resolves.toBeUndefined();
  });

  it("refuses targets outside the account's directory", async () => {
    expect.assertions(1);
    const dir = resolveDataDir(join(scratch, "data"));
    const account = { ...accountPaths(dir, DEFAULT_ACCOUNT), profile: scratch };
    await ensureDataDir(dir);
    await expect(removeSession(dir, account)).rejects.toThrow(/refusing to delete/u);
  });
});

describe("assertChildOf", () => {
  it("accepts a direct child and rejects anything else", () => {
    expect.assertions(4);
    expect(() => {
      assertChildOf("/data", "/data/profile");
    }).not.toThrow();
    expect(() => {
      assertChildOf("/data", "/data/a/b");
    }).toThrow(DataDirError);
    expect(() => {
      assertChildOf("/data", "/data/../etc");
    }).toThrow(DataDirError);
    expect(() => {
      assertChildOf("/data", "/data");
    }).toThrow(DataDirError);
  });
});
