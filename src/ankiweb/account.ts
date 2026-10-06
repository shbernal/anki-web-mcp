import type { APIRequestContext } from "playwright";

import { AnkiWebHttpError } from "./http-error.js";
import { decodeMessage, readBool } from "./protobuf.js";
import { type Fetch, fetchAnkiWeb } from "./response-cache.js";
import { ankiWebThrottle } from "./throttle.js";
import { ACCOUNT_STATUS_URL } from "./urls.js";

const HTTP_FORBIDDEN = 403;
// Field numbers, as `docs/ankiweb.md` lists them for `GetAccountStatusResponse`.
const ACCOUNT_STATUS = { loggedIn: 1, redirectTo: 2 } as const;

/**
 * Reads `logged_in`. A signed-out answer is an empty body, because protobuf
 * omits a false bool.
 */
export function decodeLoggedIn(body: Readonly<Uint8Array>): boolean {
  return readBool(decodeMessage(body), ACCOUNT_STATUS.loggedIn);
}

/**
 * Asks AnkiWeb whether the cookies held by `request` carry a live session. The
 * request context shares the browser context's cookie jar, so this needs no
 * page render.
 */
export async function checkLoggedIn(request: APIRequestContext): Promise<boolean> {
  await ankiWebThrottle.wait();
  const response = await request.post(ACCOUNT_STATUS_URL, {
    headers: { "content-type": "application/octet-stream" },
    data: Buffer.alloc(0),
  });
  if (response.status() === HTTP_FORBIDDEN) {
    return false;
  }
  if (!response.ok()) {
    throw new AnkiWebHttpError(response.status(), await response.text(), ACCOUNT_STATUS_URL);
  }
  return decodeLoggedIn(await response.body());
}

/**
 * The same question as `checkLoggedIn`, asked over plain `fetch` with a
 * `Cookie` header, so it needs no browser.
 */
export async function checkLoggedInOverHttp(fetcher: Fetch, cookie: string): Promise<boolean> {
  const response = await fetchAnkiWeb(fetcher, ACCOUNT_STATUS_URL, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", cookie },
    body: new Uint8Array(),
  });
  if (response.status === HTTP_FORBIDDEN) {
    return false;
  }
  if (!response.ok) {
    throw new AnkiWebHttpError(response.status, await response.text(), ACCOUNT_STATUS_URL);
  }
  return decodeLoggedIn(new Uint8Array(await response.arrayBuffer()));
}
