import { ToolError } from "../errors.js";

export const HTTP_TOO_MANY_REQUESTS = 429;

/** A non-2xx answer from AnkiWeb, carrying the plain-text reason it sends with one. */
export class AnkiWebHttpError extends ToolError {
  override name = "AnkiWebHttpError";
  readonly status: number;

  constructor(status: number, reason: string) {
    super(
      status === HTTP_TOO_MANY_REQUESTS
        ? "AnkiWeb is rate-limiting this address (HTTP 429). It allows about four searches a minute and can stay limited for a few minutes; wait before trying again."
        : `AnkiWeb answered ${status}: ${reason}`,
    );
    this.status = status;
  }
}
