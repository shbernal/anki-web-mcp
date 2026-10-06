import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readStoredSession, writeStoredSession } from "../src/browser/cookies.js";
import { sessionStatus } from "../src/browser/login.js";
import {
  type AccountPaths,
  accountPaths,
  type DataDir,
  DEFAULT_ACCOUNT,
  ensureDataDir,
  resolveDataDir,
} from "../src/data-dir.js";
import { fakeFetch } from "./fake-fetch.js";

const STORED = {
  validatedAt: "2026-10-06T12:00:00.000Z",
  cookies: [
    {
      name: "ankiweb",
      value: "token",
      domain: "ankiweb.net",
      path: "/",
      expires: 0,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ],
} as const;

/** `get-account-status` with `logged_in` set, or the empty body AnkiWeb sends signed out. */
function accountStatus(loggedIn: boolean) {
  return fakeFetch(
    async () => new Response(loggedIn ? Uint8Array.of(0x08, 0x01) : new Uint8Array()),
  );
}

let scratch: string;
let dataDir: DataDir;
let account: AccountPaths;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-"));
  dataDir = resolveDataDir(join(scratch, "data"));
  account = accountPaths(dataDir, DEFAULT_ACCOUNT);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("sessionStatus", () => {
  it("asks nothing when no data directory exists", async () => {
    expect.assertions(2);
    const status = accountStatus(true);
    await expect(sessionStatus(account, status.fetch)).resolves.toBe("missing");
    expect(status.urls).toStrictEqual([]);
  });

  it("asks nothing when the directory holds no session", async () => {
    expect.assertions(2);
    await ensureDataDir(dataDir);
    const status = accountStatus(true);
    await expect(sessionStatus(account, status.fetch)).resolves.toBe("missing");
    expect(status.urls).toStrictEqual([]);
  });

  it("reports signed in and records the check", async () => {
    expect.assertions(2);
    await ensureDataDir(dataDir);
    await writeStoredSession(account.cookies, STORED);
    await expect(sessionStatus(account, accountStatus(true).fetch)).resolves.toBe("signed-in");
    const stored = await readStoredSession(account.cookies);
    expect(stored?.validatedAt).not.toBe(STORED.validatedAt);
  });

  it("reports signed out when AnkiWeb turns the cookie down", async () => {
    expect.assertions(2);
    await ensureDataDir(dataDir);
    await writeStoredSession(account.cookies, STORED);
    await expect(sessionStatus(account, accountStatus(false).fetch)).resolves.toBe("signed-out");
    await expect(readStoredSession(account.cookies)).resolves.toStrictEqual(STORED);
  });
});
