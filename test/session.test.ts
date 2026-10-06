import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BrowserContext } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthRequiredError } from "../src/browser/auth-required-error.js";
import { readStoredSession, writeStoredSession } from "../src/browser/cookies.js";
import { BrowserSession } from "../src/browser/session.js";
import { type DataDir, resolveDataDir } from "../src/data-dir.js";
import { type FakeContext, fakeContext } from "./fake-context.js";

const SESSION_COOKIE = {
  name: "ankiweb",
  value: "token",
  domain: "ankiweb.net",
  path: "/",
  expires: 0,
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
} as const;
const IDLE_MS = 1000;

const touch = async (context: BrowserContext) => context;

let scratch: string;
let dataDir: DataDir;
let fake: FakeContext;
let launches: number;

function session(loggedIn = true): BrowserSession {
  return new BrowserSession({
    dataDir,
    idleMs: IDLE_MS,
    launch: async () => {
      launches += 1;
      return fake.context;
    },
    checkLoggedIn: async () => loggedIn,
  });
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-"));
  dataDir = resolveDataDir(join(scratch, "data"));
  fake = fakeContext();
  launches = 0;
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(scratch, { recursive: true, force: true });
});

describe("browser session", () => {
  it("launches once for concurrent callers", async () => {
    expect.assertions(1);
    const browser = session();
    await Promise.all([browser.use(touch), browser.use(touch)]);
    expect(launches).toBe(1);
  });

  it("seeds a profile without a session from the cookie export", async () => {
    expect.assertions(1);
    await session().use(touch);
    await writeStoredSession(dataDir.cookies, {
      validatedAt: "2026-10-06T12:00:00.000Z",
      cookies: [SESSION_COOKIE],
    });
    fake = fakeContext();
    await session().use(touch);
    expect(fake.jar).toStrictEqual([SESSION_COOKIE]);
  });

  it("refuses an unauthenticated call with a pointer to --login", async () => {
    expect.assertions(1);
    await expect(session(false).useAuthenticated(async () => "unreachable")).rejects.toThrow(
      AuthRequiredError,
    );
  });

  it("exports the cookies after a successful validation", async () => {
    expect.assertions(2);
    fake = fakeContext([SESSION_COOKIE]);
    const browser = session();
    await expect(browser.isAuthenticated()).resolves.toBe(true);
    const stored = await readStoredSession(dataDir.cookies);
    expect(stored?.validatedAt).toBe(browser.lastValidatedAt?.toISOString());
  });

  it("closes the browser once idle and relaunches on the next call", async () => {
    expect.assertions(3);
    const browser = session();
    await browser.use(touch);
    vi.useFakeTimers();
    const gate = new EventTarget();
    const busy = browser.use(async () => once(gate, "release"));
    await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
    expect(fake.closed()).toBe(false);
    gate.dispatchEvent(new Event("release"));
    await busy;
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(fake.closed()).toBe(true);
    await browser.use(touch);
    expect(launches).toBe(2);
  });
});
