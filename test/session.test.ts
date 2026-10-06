import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";

import type { BrowserContext, Cookie } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthRequiredError } from "../src/browser/auth-required-error.js";
import { readStoredSession, writeStoredSession } from "../src/browser/cookies.js";
import { BrowserSession, type SessionOptions } from "../src/browser/session.js";
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

function session(loggedIn = true, options: Partial<SessionOptions> = {}): BrowserSession {
  return new BrowserSession({
    dataDir,
    idleMs: IDLE_MS,
    launch: async () => {
      launches += 1;
      return fake.context;
    },
    checkLoggedIn: async () => loggedIn,
    ...options,
  });
}

/** Signed in exactly when the jar holds a session cookie whose value is `good`. */
const checkJar = async () => fake.jar.some((cookie: Readonly<Cookie>) => cookie.value === "good");

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

describe("taking turns", () => {
  it("runs one call at a time, in the order they arrived", async () => {
    expect.assertions(1);
    const browser = session();
    const events: string[] = [];
    const step = (name: string) => async () => {
      events.push(`${name} start`);
      await setImmediate();
      events.push(`${name} end`);
    };
    await Promise.all([browser.use(step("a")), browser.use(step("b"))]);
    expect(events).toStrictEqual(["a start", "a end", "b start", "b end"]);
  });

  it("lets the next call run after one fails", async () => {
    expect.assertions(2);
    const browser = session();
    const failing = browser.use(async () => {
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrow("boom");
    await expect(browser.use(async () => "next")).resolves.toBe("next");
  });

  it("closes on release only after the call in progress", async () => {
    expect.assertions(3);
    const browser = session();
    let closedDuringCall = true;
    const call = browser.use(async () => {
      await setImmediate();
      closedDuringCall = fake.closed();
    });
    await expect(browser.release()).resolves.toBe(true);
    await call;
    expect(closedDuringCall).toBe(false);
    await expect(browser.release()).resolves.toBe(false);
  });
});

describe("adopting imported cookies", () => {
  it("keeps cookies AnkiWeb accepts and exports them", async () => {
    expect.assertions(3);
    const browser = session(true, { checkLoggedIn: checkJar });
    await expect(browser.adoptCookies([{ ...SESSION_COOKIE, value: "good" }])).resolves.toBe(true);
    expect(fake.jar.map((cookie: Readonly<Cookie>) => cookie.value)).toStrictEqual(["good"]);
    const stored = await readStoredSession(dataDir.cookies);
    expect(stored?.cookies.map((cookie) => cookie.value)).toStrictEqual(["good"]);
  });

  it("clears rejected cookies so the next candidate starts clean", async () => {
    expect.assertions(2);
    const browser = session(true, { checkLoggedIn: checkJar });
    await expect(browser.adoptCookies([SESSION_COOKIE])).resolves.toBe(false);
    expect(fake.jar).toStrictEqual([]);
  });

  it("imports once, the first time a call needs a session", async () => {
    expect.assertions(3);
    const autoImport = vi.fn<NonNullable<SessionOptions["autoImport"]>>(async (adopt) =>
      adopt([{ ...SESSION_COOKIE, value: "good" }]),
    );
    const browser = session(true, { checkLoggedIn: checkJar, autoImport });
    await expect(browser.useAuthenticated(async () => "ran")).resolves.toBe("ran");
    await expect(browser.useAuthenticated(async () => "again")).resolves.toBe("again");
    expect(autoImport).toHaveBeenCalledOnce();
  });

  it("says why the import failed, and does not retry it", async () => {
    expect.assertions(3);
    const autoImport = vi.fn<NonNullable<SessionOptions["autoImport"]>>(async () => {
      throw new Error("No Chromium-family browser profile holds a live AnkiWeb session.");
    });
    const browser = session(false, { autoImport });
    const call = browser.useAuthenticated(async () => "unreachable");
    await expect(call).rejects.toThrow(AuthRequiredError);
    await expect(call).rejects.toThrow(/holds a live AnkiWeb session.*--login/u);
    await browser.useAuthenticated(async () => "unreachable").catch(() => "refused");
    expect(autoImport).toHaveBeenCalledOnce();
  });
});
