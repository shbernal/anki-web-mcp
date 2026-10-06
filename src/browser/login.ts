import { setTimeout as sleep } from "node:timers/promises";

import type { BrowserContext } from "playwright";

import { checkLoggedIn } from "../ankiweb/account.js";
import type { Fetch } from "../ankiweb/response-cache.js";
import { LOGIN_URL } from "../ankiweb/urls.js";
import {
  type AccountPaths,
  checkDataDir,
  type DataDir,
  ensureAccount,
  removeSession,
} from "../data-dir.js";
import {
  checkStoredSession,
  hasSessionCookie,
  readStoredSession,
  SESSION_URLS,
} from "./cookies.js";
import { launchContext } from "./launch.js";
import { assertProfileFree, lockProfile } from "./profile-lock.js";
import { exportSession } from "./session.js";

/** Ten minutes. */
const LOGIN_TIMEOUT_MS = 600_000;
const POLL_INTERVAL_MS = 1000;

/**
 * Opens a visible browser on AnkiWeb's login page and waits for the user to sign
 * in, then stores the session and closes the window. The password never passes
 * through this process: AnkiWeb's own form takes it.
 */
export async function login(
  dataDir: DataDir,
  account: AccountPaths,
  channel: string | undefined,
): Promise<void> {
  await ensureAccount(dataDir, account);
  const unlock = await lockProfile(account, "login");
  try {
    await signIn(dataDir, account, channel);
  } finally {
    await unlock();
  }
}

async function signIn(
  dataDir: DataDir,
  account: AccountPaths,
  channel: string | undefined,
): Promise<void> {
  const context = await launchContext({
    profileDir: account.profile,
    downloadsDir: dataDir.downloads,
    headless: false,
    channel,
  });
  const closed = { value: false };
  context.on("close", () => {
    closed.value = true;
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(LOGIN_URL);
    console.error("anki-web-mcp: sign in to AnkiWeb in the browser window");
    await waitForSignIn(context, closed);
    await exportSession(context, account, new Date());
    console.error(`anki-web-mcp: signed in; session stored in ${account.dir}`);
  } finally {
    if (!closed.value) {
      await context.close();
    }
  }
}

async function waitForSignIn(
  context: BrowserContext,
  closed: Readonly<{ value: boolean }>,
): Promise<void> {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (closed.value) {
      throw new Error("The browser window was closed before signing in");
    }
    // The cookie is free to read; the round trip to AnkiWeb waits until it exists.
    if (
      hasSessionCookie(await context.cookies([...SESSION_URLS])) &&
      (await checkLoggedIn(context.request))
    ) {
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("Timed out waiting for the AnkiWeb sign-in");
}

/** Deletes the stored session, unless a browser has the profile open. */
export async function logout(dataDir: DataDir, account: AccountPaths): Promise<void> {
  await assertProfileFree(account);
  await removeSession(dataDir, account);
}

/** What `--status` found: no session on disk, or AnkiWeb's answer for the one there is. */
export type SessionState = "missing" | "signed-in" | "signed-out";

/**
 * Asks AnkiWeb about the session in `cookies.json` over plain `fetch`. It opens
 * no browser and takes no profile lock, so it runs beside a server that has the
 * profile open, and it never looks at the profile itself.
 */
export async function sessionStatus(
  account: AccountPaths,
  fetcher: Fetch = fetch,
): Promise<SessionState> {
  const stored = (await checkDataDir(account.dir))
    ? await readStoredSession(account.cookies)
    : undefined;
  if (stored === undefined || !hasSessionCookie(stored.cookies)) {
    return "missing";
  }
  return (await checkStoredSession(account.cookies, fetcher)) ? "signed-in" : "signed-out";
}
