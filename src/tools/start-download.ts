import { AnkiWebHttpError, HTTP_TOO_MANY_REQUESTS } from "../ankiweb/http-error.js";
import type { SharedDeckDownload, SharedDecks } from "../ankiweb/shared.js";
import { AuthRequiredError } from "../browser/auth-required-error.js";
import { storedSessionCookie } from "../browser/cookies.js";
import { ToolError } from "../errors.js";

const DOWNLOAD_LIMIT =
  "AnkiWeb allows only a few downloads without signing in, and this address has used them.";

/** How a download got through: without a cookie, or with the account's session. */
type Via = "anonymous" | "session";

/** An account's session: its stored cookie file, and a browser that can hand over a cookie. */
type CookieSource = Readonly<{
  account: Readonly<{ cookies: string }>;
  sessionCookie: () => Promise<string>;
}>;

interface StartedDownload {
  readonly download: SharedDeckDownload;
  readonly via: Via;
}

function isTooManyRequests(error: unknown): error is AnkiWebHttpError {
  return error instanceof AnkiWebHttpError && error.status === HTTP_TOO_MANY_REQUESTS;
}

/** The session's cookie, explaining why one is needed when there is none. */
async function signedInCookie(session: CookieSource): Promise<string> {
  try {
    return await session.sessionCookie();
  } catch (error) {
    throw error instanceof AuthRequiredError
      ? new ToolError(`${DOWNLOAD_LIMIT} ${error.message}`, { cause: error })
      : error;
  }
}

/**
 * Downloads anonymously while AnkiWeb allows it, which needs no browser. Past
 * that, AnkiWeb answers 429 and asks for a login, so the download is retried
 * with the cookie `cookies.json` holds, and only if AnkiWeb asks for a login
 * again with the browser's, since the profile may hold a newer one. A daily
 * limit is the account's or the address's answer, which the browser's cookie,
 * the same account on the same address, would get too.
 */
export async function startDownload(
  shared: SharedDecks,
  session: CookieSource,
  id: number,
): Promise<StartedDownload> {
  try {
    return { download: await shared.download(id), via: "anonymous" };
  } catch (error) {
    if (!isTooManyRequests(error)) {
      throw error;
    }
  }
  const stored = await storedSessionCookie(session.account.cookies);
  if (stored !== undefined) {
    try {
      return { download: await shared.download(id, stored), via: "session" };
    } catch (error) {
      if (!isTooManyRequests(error) || error.dailyLimit) {
        throw error;
      }
    }
  }
  return { download: await shared.download(id, await signedInCookie(session)), via: "session" };
}
