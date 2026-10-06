import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredCookie } from "../src/browser/cookies.js";
import type { Keystore } from "../src/import/discovery.js";
import {
  chromiumTimeToUnix,
  CookieDecryptionError,
  decryptValue,
  extractCookies,
  sameSiteFromChromium,
} from "../src/import/extract.js";
import {
  chromiumTime,
  encrypt,
  key,
  KEYRING_PASSWORD,
  MAC,
  NOW,
  PEANUTS,
  writeCookiesDb,
} from "./chromium-cookies.js";

const KEYRING_KEY = key(KEYRING_PASSWORD, 1);

function v10(plaintext: string): Buffer {
  return encrypt(plaintext, { prefix: "v10", key: PEANUTS });
}

let scratch: string;
const keyring = vi.fn<(keystore: Keystore) => Promise<Buffer>>();

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-extract-"));
  keyring.mockResolvedValue(Buffer.from(KEYRING_PASSWORD));
});

afterEach(async () => {
  keyring.mockReset();
  await rm(scratch, { recursive: true, force: true });
});

async function values(cookies: Promise<readonly StoredCookie[]>): Promise<readonly string[]> {
  const extracted = await cookies;
  return extracted.map((cookie) => cookie.value);
}

describe("cookie decryption", () => {
  it("decrypts v10 with the built-in Linux password and no keystore", async () => {
    expect.assertions(2);
    const profile = await writeCookiesDb(scratch, {
      name: "v10",
      version: 23,
      rows: [
        {
          host: "ankiweb.net",
          name: "ankiweb",
          encrypted: encrypt("token", { prefix: "v10", key: PEANUTS }),
        },
      ],
    });
    await expect(values(extractCookies(profile, keyring))).resolves.toStrictEqual(["token"]);
    expect(keyring).not.toHaveBeenCalled();
  });

  it("strips the host digest from store version 24 on", async () => {
    expect.assertions(1);
    const encrypted = encrypt("1", { prefix: "v10", key: PEANUTS, digestHost: ".ankiweb.net" });
    const profile = await writeCookiesDb(scratch, {
      name: "v10-digest",
      version: 24,
      rows: [{ host: ".ankiweb.net", name: "has_auth", encrypted }],
    });
    await expect(values(extractCookies(profile, keyring))).resolves.toStrictEqual(["1"]);
  });

  it("decrypts v11 with the keyring password", async () => {
    expect.assertions(2);
    const encrypted = encrypt("token", {
      prefix: "v11",
      key: KEYRING_KEY,
      digestHost: "ankiweb.net",
    });
    const profile = await writeCookiesDb(scratch, {
      name: "v11",
      version: 24,
      rows: [{ host: "ankiweb.net", name: "ankiweb", encrypted }],
    });
    await expect(values(extractCookies(profile, keyring))).resolves.toStrictEqual(["token"]);
    expect(keyring).toHaveBeenCalledOnce();
  });

  it("derives the macOS key with 1003 iterations of the keychain password", async () => {
    expect.assertions(1);
    const encrypted = encrypt("token", { prefix: "v10", key: key(KEYRING_PASSWORD, 1003) });
    const profile = await writeCookiesDb(scratch, {
      name: "mac",
      version: 23,
      rows: [{ host: "ankiweb.net", name: "ankiweb", encrypted }],
      keystore: MAC,
    });
    await expect(values(extractCookies(profile, keyring))).resolves.toStrictEqual(["token"]);
  });

  it("keeps only the auth cookies, in Playwright's shape", async () => {
    expect.assertions(1);
    const profile = await writeCookiesDb(scratch, {
      name: "shape",
      version: 23,
      rows: [
        { host: "ankiweb.net", name: "ankiweb", encrypted: v10("token"), sameSite: 2 },
        { host: "ankiweb.net", name: "has_auth", encrypted: v10("1"), expires: 0n, sameSite: 0 },
        { host: "ankiweb.net", name: "_ga", encrypted: v10("analytics") },
        { host: "example.com", name: "ankiweb", encrypted: v10("elsewhere") },
      ],
    });
    const shared = { domain: "ankiweb.net", path: "/", httpOnly: true, secure: true } as const;
    const expected: StoredCookie[] = [
      {
        ...shared,
        name: "ankiweb",
        value: "token",
        expires: Date.parse("2027-01-01T00:00:00Z") / 1000,
        sameSite: "Strict",
      },
      { ...shared, name: "has_auth", value: "1", expires: -1, sameSite: "None" },
    ];
    await expect(extractCookies(profile, keyring)).resolves.toStrictEqual(expected);
  });

  it("converts Chromium's epoch and samesite codes", () => {
    expect.assertions(2);
    expect(chromiumTimeToUnix(chromiumTime(NOW))).toBe(NOW.getTime() / 1000);
    expect([-1n, 0n, 1n, 2n, 7n].map((code) => sameSiteFromChromium(code))).toStrictEqual([
      "Lax",
      "None",
      "Lax",
      "Strict",
      "Lax",
    ]);
  });

  it("reports a wrong key rather than returning garbage", () => {
    expect.assertions(1);
    const blob = encrypt("token", { prefix: "v11", key: KEYRING_KEY, digestHost: "ankiweb.net" });
    expect(() => decryptValue(blob, key("wrong", 1), "ankiweb.net")).toThrow(CookieDecryptionError);
  });

  it("refuses app-bound v20 values", () => {
    expect.assertions(1);
    expect(() => decryptValue(Buffer.from("v20abc"), PEANUTS, "ankiweb.net")).toThrow(
      /unsupported cookie encryption "v20"/u,
    );
  });
});
