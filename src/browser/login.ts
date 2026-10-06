import { setTimeout as sleep } from "node:timers/promises";

import type { BrowserContext } from "playwright";

import { checkLoggedIn, LOGIN_URL } from "../ankiweb/account.js";
import { type DataDir, ensureDataDir } from "../data-dir.js";
import { hasSessionCookie, SESSION_URLS } from "./cookies.js";
import { launchContext } from "./launch.js";
import { exportSession } from "./session.js";

/** Ten minutes. */
const LOGIN_TIMEOUT_MS = 600_000;
const POLL_INTERVAL_MS = 1000;

/**
 * Opens a visible browser on AnkiWeb's login page and waits for the user to sign
 * in, then stores the session and closes the window. The password never passes
 * through this process: AnkiWeb's own form takes it.
 */
export async function login(dataDir: DataDir, channel: string | undefined): Promise<void> {
  await ensureDataDir(dataDir);
  const context = await launchContext({
    profileDir: dataDir.profile,
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
    await exportSession(context, dataDir, new Date());
    console.error(`anki-web-mcp: signed in; session stored in ${dataDir.root}`);
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
