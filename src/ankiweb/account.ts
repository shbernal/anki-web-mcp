import type { APIRequestContext } from "playwright";

import { ACCOUNT_STATUS_URL } from "./urls.js";

const HTTP_FORBIDDEN = 403;
const WIRE_TYPE_BITS = 3;
const WIRE_TYPE_MASK = 0b111;
const VARINT = 0;
const LOGGED_IN_TAG = (1 << WIRE_TYPE_BITS) | VARINT;
const CONTINUATION_BIT = 0x80;

/**
 * Decodes `GetAccountStatusResponse { bool logged_in = 1; optional string
 * redirect_to = 2; }`. Only `logged_in` matters here, and a signed-out answer is
 * an empty body because protobuf omits a false bool.
 */
export function decodeLoggedIn(body: Readonly<Uint8Array>): boolean {
  let offset = 0;
  let loggedIn = false;
  while (offset < body.length) {
    const tag = body[offset] ?? 0;
    offset += 1;
    if (tag === LOGGED_IN_TAG) {
      loggedIn = (body[offset] ?? 0) !== 0;
      offset += 1;
    } else if ((tag & WIRE_TYPE_MASK) === VARINT) {
      while (((body[offset] ?? 0) & CONTINUATION_BIT) !== 0) {
        offset += 1;
      }
      offset += 1;
    } else {
      // A length-delimited `redirect_to` can only follow `logged_in`, which
      // protobuf writes in field order, so there is nothing left to read.
      break;
    }
  }
  return loggedIn;
}

/**
 * Asks AnkiWeb whether the cookies held by `request` carry a live session. The
 * request context shares the browser context's cookie jar, so this needs no
 * page render.
 */
export async function checkLoggedIn(request: APIRequestContext): Promise<boolean> {
  const response = await request.post(ACCOUNT_STATUS_URL, {
    headers: { "content-type": "application/octet-stream" },
    data: Buffer.alloc(0),
  });
  if (response.status() === HTTP_FORBIDDEN) {
    return false;
  }
  if (!response.ok()) {
    throw new Error(
      `AnkiWeb answered the session check with ${response.status()}: ${await response.text()}`,
    );
  }
  return decodeLoggedIn(await response.body());
}
