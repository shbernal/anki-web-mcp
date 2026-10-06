import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertChildOf,
  checkDataDir,
  DataDirError,
  ensureDataDir,
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

describe("resolveDataDir", () => {
  it("prefers the flag, then the environment, then the home directory", () => {
    expect.assertions(3);
    const env = { ANKI_WEB_MCP_DATA_DIR: "/from/env" };
    expect(resolveDataDir("/from/flag", env).root).toBe("/from/flag");
    expect(resolveDataDir(undefined, env).cookies).toBe("/from/env/cookies.json");
    expect(resolveDataDir(undefined, {}).root).toMatch(/\.anki-web-mcp$/u);
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
});

describe("removeSession", () => {
  it("deletes the profile and the cookie export and keeps downloads", async () => {
    expect.assertions(1);
    const dir = resolveDataDir(join(scratch, "data"));
    await ensureDataDir(dir);
    await mkdir(dir.profile);
    await writeFile(join(dir.profile, "Cookies"), "");
    await writeFile(dir.cookies, "{}");
    await removeSession(dir);
    await expect(readdir(dir.root)).resolves.toStrictEqual(["downloads"]);
  });

  it("does nothing when there is no data dir", async () => {
    expect.assertions(1);
    const missing = resolveDataDir(join(scratch, "missing"));
    await expect(removeSession(missing)).resolves.toBeUndefined();
  });

  it("refuses targets outside the data dir", async () => {
    expect.assertions(1);
    const dir = { ...resolveDataDir(join(scratch, "data")), profile: scratch };
    await ensureDataDir(dir);
    await expect(removeSession(dir)).rejects.toThrow(/refusing to delete/u);
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
