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
