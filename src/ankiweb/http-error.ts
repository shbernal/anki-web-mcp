import { ToolError } from "../errors.js";
import { isSharedSearchUrl } from "./urls.js";

export const HTTP_TOO_MANY_REQUESTS = 429;

/** Longer than any reason AnkiWeb has been seen to send, short enough to keep a page out. */
const MAX_REASON_LENGTH = 200;

/**
 * The search limit's own wording. A refused search comes back with "Failed to
 * parse input.", which says nothing, so the body is not quoted for one.
 */
const SEARCH_LIMIT =
  "AnkiWeb is rate-limiting this address (HTTP 429). It allows about four searches a minute and can stay limited for a few minutes; wait before trying again.";

function quoted(reason: string): string {
  const trimmed = reason.trim();
  return trimmed.length > MAX_REASON_LENGTH ? `${trimmed.slice(0, MAX_REASON_LENGTH)}…` : trimmed;
}

function message(status: number, reason: string, url: string | undefined): string {
  if (status !== HTTP_TOO_MANY_REQUESTS) {
    return `AnkiWeb answered ${status}: ${quoted(reason)}`;
  }
  if (url !== undefined && isSharedSearchUrl(url)) {
    return SEARCH_LIMIT;
  }
  const said = quoted(reason);
  const reasonSentence = said === "" ? "" : ` It says: "${said}"`;
  return `AnkiWeb is rate-limiting this address (HTTP 429).${reasonSentence} Wait a few minutes before trying again.`;
}

/** A non-2xx answer from AnkiWeb, carrying the plain-text reason it sends with one. */
export class AnkiWebHttpError extends ToolError {
  override name = "AnkiWebHttpError";
  readonly status: number;

  /** `url` is the request's, which decides how a `429` is worded. */
  constructor(status: number, reason: string, url?: string) {
    super(message(status, reason, url));
    this.status = status;
  }
}
