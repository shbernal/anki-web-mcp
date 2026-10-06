import type { APIRequestContext } from "playwright";

import { AuthRequiredError } from "../browser/auth-required-error.js";
import { AnkiWebHttpError } from "./http-error.js";
import { ankiWebThrottle } from "./throttle.js";

const HTTP_FORBIDDEN = 403;

/**
 * Posts a protobuf request to a session-only `/svc/...` endpoint through the
 * browser context's cookie jar, and returns the response body. A `403` means
 * the session is missing or has lapsed.
 */
export async function postService(
  request: APIRequestContext,
  url: string,
  body: Readonly<Uint8Array> = new Uint8Array(),
): Promise<Uint8Array> {
  await ankiWebThrottle.wait();
  const response = await request.post(url, {
    headers: { "content-type": "application/octet-stream" },
    data: Buffer.from(body),
  });
  if (response.status() === HTTP_FORBIDDEN) {
    throw new AuthRequiredError();
  }
  if (!response.ok()) {
    throw new AnkiWebHttpError(response.status(), await response.text(), url);
  }
  return response.body();
}
