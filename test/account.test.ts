import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { decodeLoggedIn } from "../src/ankiweb/account.js";

describe("decodeLoggedIn", () => {
  it("reads a signed-in account status", async () => {
    expect.assertions(1);
    const body = await readFile(
      new URL("fixtures/ankiweb/account-status-logged-in.bin", import.meta.url),
    );
    expect(decodeLoggedIn(body)).toBe(true);
  });

  it("reads the empty body AnkiWeb sends without a session as signed out", () => {
    expect.assertions(1);
    expect(decodeLoggedIn(new Uint8Array())).toBe(false);
  });

  it("ignores a redirect after the flag", () => {
    expect.assertions(1);
    // Logged_in = true, then redirect_to = "/x".
    expect(decodeLoggedIn(Uint8Array.of(0x08, 0x01, 0x12, 0x02, 0x2f, 0x78))).toBe(true);
  });
});
