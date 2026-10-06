import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readStoredSession, writeStoredSession } from "../src/browser/cookies.js";
import { sessionStatus, statusReport } from "../src/browser/login.js";
import {
  type AccountPaths,
  accountPaths,
  type DataDir,
  chosenAccount,
  DEFAULT_ACCOUNT,
  ensureAccount,
  ensureDataDir,
  loginCommand,
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

/** Stores a session for `name` whose cookie value is the name itself. */
async function storeSession(name: string): Promise<void> {
  const paths = accountPaths(dataDir, name);
  await ensureAccount(dataDir, paths);
  await writeStoredSession(paths.cookies, {
    ...STORED,
    cookies: [{ ...STORED.cookies[0], value: name }],
  });
}

/** Signed in for exactly the accounts named, judged by the cookie each sends. */
function signedInAs(...names: readonly string[]) {
  return fakeFetch(async (_url, cookie) => {
    const loggedIn = names.some((name) => cookie === `ankiweb=${name}`);
    return new Response(loggedIn ? Uint8Array.of(0x08, 0x01) : new Uint8Array());
  });
}

describe("statusReport", () => {
  it("reads as before accounts had names on a fresh install", async () => {
    expect.assertions(1);
    await expect(statusReport(dataDir, undefined, signedInAs().fetch)).resolves.toStrictEqual({
      lines: [`no session stored in ${dataDir.root}; run --login or --import-from-browser`],
      signedIn: false,
    });
  });

  it("reads as before accounts had names with the default account alone", async () => {
    expect.assertions(2);
    await storeSession(DEFAULT_ACCOUNT);
    await expect(
      statusReport(dataDir, undefined, signedInAs(DEFAULT_ACCOUNT).fetch),
    ).resolves.toStrictEqual({
      lines: [`signed in to AnkiWeb; session stored in ${dataDir.root}`],
      signedIn: true,
    });
    await expect(statusReport(dataDir, undefined, signedInAs().fetch)).resolves.toStrictEqual({
      lines: ["AnkiWeb turned down the stored session; run --login"],
      signedIn: false,
    });
  });

  it("checks every account, a line each, and fails if any is not signed in", async () => {
    expect.assertions(2);
    await storeSession(DEFAULT_ACCOUNT);
    await storeSession("work");
    await ensureAccount(dataDir, accountPaths(dataDir, "home"));
    const status = signedInAs(DEFAULT_ACCOUNT);
    await expect(statusReport(dataDir, undefined, status.fetch)).resolves.toStrictEqual({
      lines: [
        "default: signed in",
        "home: no session; run --login --account home",
        "work: signed out; run --login --account work",
      ],
      signedIn: false,
    });
    expect(status.urls).toHaveLength(2);
  });

  it("checks only the account chosen, naming it in the advice", async () => {
    expect.assertions(1);
    await storeSession(DEFAULT_ACCOUNT);
    const work = accountPaths(dataDir, "work");
    await expect(
      statusReport(dataDir, "work", signedInAs(DEFAULT_ACCOUNT).fetch),
    ).resolves.toStrictEqual({
      lines: [
        `no session stored in ${work.dir}; run --login --account work or --import-from-browser <browser> --account work`,
      ],
      signedIn: false,
    });
  });
});

describe("account choice", () => {
  it("takes the flag over the environment, and neither means none", () => {
    expect.assertions(3);
    const env = { ANKI_WEB_MCP_ACCOUNT: "home" };
    expect(chosenAccount("work", env)).toBe("work");
    expect(chosenAccount(undefined, env)).toBe("home");
    expect(chosenAccount(undefined, {})).toBeUndefined();
  });

  it("names --account in the sign-in command for a named account only", () => {
    expect.assertions(2);
    expect(loginCommand(DEFAULT_ACCOUNT)).toBe("anki-web-mcp --login");
    expect(loginCommand("work")).toBe("anki-web-mcp --login --account work");
  });
});
