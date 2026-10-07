import { setTimeout as sleep } from "node:timers/promises";

import type { BrowserContext } from "playwright";

import { checkLoggedIn } from "../ankiweb/account.js";
import type { Fetch } from "../ankiweb/response-cache.js";
import { LOGIN_URL } from "../ankiweb/urls.js";
import {
  type AccountPaths,
  accountPaths,
  checkDataDir,
  type DataDir,
  DEFAULT_ACCOUNT,
  ensureAccount,
  listAccounts,
  loginFlags,
  removeSession,
} from "../data-dir.js";
import {
  checkStoredSession,
  exportSession,
  hasSessionCookie,
  readStoredSession,
  SESSION_URLS,
} from "./cookies.js";
import { launchContext } from "./launch.js";
import { assertProfileFree, lockProfile } from "./profile-lock.js";

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
    await exportSession(context, account.cookies, new Date());
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

/** What `--status` prints, a line each, and whether every account checked is signed in. */
export interface StatusReport {
  readonly lines: readonly string[];
  readonly signedIn: boolean;
}

const WORDS: Readonly<Record<SessionState, string>> = {
  "signed-in": "signed in",
  "signed-out": "signed out",
  missing: "no session",
};

/**
 * Checks `chosen`, or with none chosen every stored account. With nothing but
 * the default account stored, or nothing at all, it reads as it did before
 * accounts had names.
 */
export async function statusReport(
  dataDir: DataDir,
  chosen: string | undefined,
  fetcher: Fetch = fetch,
): Promise<StatusReport> {
  const names = chosen === undefined ? await listAccounts(dataDir) : [chosen];
  const [only, ...others] = names.length === 0 ? [DEFAULT_ACCOUNT] : names;
  if (only !== undefined && others.length === 0) {
    const account = accountPaths(dataDir, only);
    return describeOne(account, await sessionStatus(account, fetcher));
  }
  const lines: string[] = [];
  let signedIn = true;
  // One at a time, as the server spaces its own requests to AnkiWeb.
  for (const name of names) {
    const state = await sessionStatus(accountPaths(dataDir, name), fetcher);
    signedIn &&= state === "signed-in";
    lines.push(
      state === "signed-in"
        ? `${name}: ${WORDS[state]}`
        : `${name}: ${WORDS[state]}; run ${loginFlags(name)}`,
    );
  }
  return { lines, signedIn };
}

function describeOne(account: AccountPaths, state: SessionState): StatusReport {
  const loginAgain = loginFlags(account.name);
  const importFlags =
    account.name === DEFAULT_ACCOUNT
      ? "--import-from-browser"
      : `--import-from-browser <browser> --account ${account.name}`;
  if (state === "signed-in") {
    return { lines: [`signed in to AnkiWeb; session stored in ${account.dir}`], signedIn: true };
  }
  const line =
    state === "missing"
      ? `no session stored in ${account.dir}; run ${loginAgain} or ${importFlags}`
      : `AnkiWeb turned down the stored session; run ${loginAgain}`;
  return { lines: [line], signedIn: false };
}
