import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  authCookies,
  hasSessionCookie,
  readStoredSession,
  type StoredCookie,
  writeStoredSession,
} from "../src/browser/cookies.js";

const PERMISSION_BITS = 0o777;

function cookie(name: string, domain: string): StoredCookie {
  return {
    name,
    value: "v",
    domain,
    path: "/",
    expires: 0,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  };
}

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("authCookies", () => {
  it("keeps the session cookies of both hosts and drops the rest", () => {
    expect.assertions(1);
    const kept = authCookies([
      cookie("ankiweb", "ankiweb.net"),
      cookie("has_auth", ".ankiuser.net"),
      cookie("_ga", "ankiweb.net"),
      cookie("ankiweb", "example.com"),
    ]);
    expect(kept.map(({ name, domain }) => `${name}@${domain}`)).toStrictEqual([
      "ankiweb@ankiweb.net",
      "has_auth@.ankiuser.net",
    ]);
  });

  it("copies only the fields addCookies takes", () => {
    expect.assertions(1);
    const [kept] = authCookies([{ ...cookie("ankiweb", "ankiweb.net"), partitionKey: "p" }]);
    expect(kept).toStrictEqual(cookie("ankiweb", "ankiweb.net"));
  });
});

describe("hasSessionCookie", () => {
  it("needs ankiweb on ankiweb.net", () => {
    expect.assertions(3);
    expect(hasSessionCookie([cookie("ankiweb", ".ankiweb.net")])).toBe(true);
    expect(hasSessionCookie([cookie("ankiweb", "ankiuser.net")])).toBe(false);
    expect(hasSessionCookie([cookie("has_auth", "ankiweb.net")])).toBe(false);
  });
});

describe("stored session", () => {
  it("round-trips through a file only its owner can read", async () => {
    expect.assertions(2);
    const path = join(scratch, "cookies.json");
    const session = {
      validatedAt: "2026-10-06T12:00:00.000Z",
      cookies: [cookie("ankiweb", "ankiweb.net")],
    };
    await writeStoredSession(path, session);
    await expect(readStoredSession(path)).resolves.toStrictEqual(session);
    const file = await stat(path);
    expect(file.mode & PERMISSION_BITS).toBe(0o600);
  });

  it("reads as absent when there is no file", async () => {
    expect.assertions(1);
    await expect(readStoredSession(join(scratch, "missing.json"))).resolves.toBeUndefined();
  });
});
