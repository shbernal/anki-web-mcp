import { afterEach, describe, expect, it, vi } from "vitest";

import { AnkiWebHttpError } from "../src/ankiweb/http-error.js";
import { ProtobufError } from "../src/ankiweb/protobuf.js";
import { Throttle } from "../src/ankiweb/throttle.js";
import { AuthRequiredError } from "../src/browser/auth-required-error.js";
import { describeError, guarded, redact, ToolError } from "../src/errors.js";

const COOKIE_VALUE = "s3cr3t-session-value";

afterEach(() => {
  vi.restoreAllMocks();
});

function networkError(code: string): Error {
  return new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
}

describe("describeError", () => {
  it("passes a tool error's own message through", () => {
    expect.assertions(2);
    expect(describeError(new AuthRequiredError(), "t")).toMatch(/--login/u);
    expect(describeError(new AnkiWebHttpError(500, "oops"), "t")).toBe(
      "AnkiWeb answered 500: oops",
    );
  });

  it("words a 429 by the request it answered", () => {
    expect.assertions(4);
    const search = "https://ankiweb.net/svc/shared/list-decks?search=x";
    const download = "https://ankiweb.net/svc/shared/download-deck/1?t=k";
    expect(describeError(new AnkiWebHttpError(429, "Failed to parse input.", search), "t")).toMatch(
      /four a minute, and a block has been seen to last over an hour/u,
    );
    expect(
      describeError(
        new AnkiWebHttpError(429, "Please log in to download more decks.", download),
        "t",
      ),
    ).toBe(
      'AnkiWeb is rate-limiting this address (HTTP 429). It says: "Please log in to download more decks." Wait a few minutes before trying again.',
    );
    expect(
      describeError(
        new AnkiWebHttpError(429, "Daily limit exceeded; please try again tomorrow.", download),
        "t",
      ),
    ).toBe(
      'AnkiWeb has refused further downloads today (HTTP 429). It says: "Daily limit exceeded; please try again tomorrow." Retrying before tomorrow will fail the same way.',
    );
    expect(describeError(new AnkiWebHttpError(429, "", download), "t")).toBe(
      "AnkiWeb is rate-limiting this address (HTTP 429). Wait a few minutes before trying again.",
    );
  });

  it("calls an undecodable payload a sign that AnkiWeb changed", () => {
    expect.assertions(1);
    expect(describeError(new ProtobufError("Truncated varint"), "t")).toMatch(
      /does not understand \(Truncated varint\).*issues/u,
    );
  });

  it("names a network failure and a timeout", () => {
    expect.assertions(2);
    expect(describeError(networkError("ENOTFOUND"), "t")).toMatch(
      /Could not reach AnkiWeb \(ENOTFOUND\)/u,
    );
    expect(describeError(new DOMException("late", "TimeoutError"), "t")).toMatch(
      /did not answer in time/u,
    );
  });

  it("summarizes anything else without quoting it", () => {
    expect.assertions(2);
    const text = describeError(new Error(`Cookie: ankiweb=${COOKIE_VALUE}`), "share_deck");
    expect(text).toMatch(/^share_deck failed unexpectedly/u);
    expect(text).not.toContain(COOKIE_VALUE);
  });
});

describe("redact", () => {
  it("masks session cookie values in headers and messages", () => {
    expect.assertions(1);
    expect(redact(`cookie: ankiweb=${COOKIE_VALUE}; has_auth=1; other=kept`)).toBe(
      "cookie: ankiweb=<redacted>; has_auth=<redacted>; other=kept",
    );
  });
});

describe("guarded", () => {
  it("returns a tool error without logging it", async () => {
    expect.assertions(2);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = guarded("t", async () => {
      throw new ToolError(`bad ankiweb=${COOKIE_VALUE}`);
    });
    await expect(handler()).resolves.toStrictEqual({
      content: [{ type: "text", text: "bad ankiweb=<redacted>" }],
      isError: true,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("logs an unexpected error's stack with cookie values masked", async () => {
    expect.assertions(3);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = guarded("t", async () => {
      throw new Error(`header ankiweb=${COOKIE_VALUE}`);
    });
    const result = await handler();
    expect(JSON.stringify(result)).not.toContain(COOKIE_VALUE);
    const logged: unknown = log.mock.calls[0]?.[0];
    expect(String(logged)).toMatch(/header ankiweb=<redacted>\n\s+at /u);
    expect(String(logged)).not.toContain(COOKIE_VALUE);
  });

  it("leaves a successful result alone", async () => {
    expect.assertions(1);
    await expect(guarded("t", async (value: number) => value + 1)(1)).resolves.toBe(2);
  });
});

describe("throttle", () => {
  it("spaces requests by the gap, including concurrent ones", async () => {
    expect.assertions(1);
    const gap = 40;
    const throttle = new Throttle(gap);
    const started = Date.now();
    await Promise.all([throttle.wait(), throttle.wait(), throttle.wait()]);
    // The first goes at once and the other two wait one gap each.
    expect(Date.now() - started).toBeGreaterThanOrEqual(2 * gap - 5);
  });
});
