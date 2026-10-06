import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredCookie } from "../src/browser/cookies.js";
import type { Keystore } from "../src/import/discovery.js";
import { BrowserImportError, importFromBrowser } from "../src/import/orchestrate.js";
import {
  chromiumTime,
  EARLIER,
  encrypt,
  key,
  KEYRING_PASSWORD,
  NOW,
  PEANUTS,
  type Row,
  writeCookiesDb,
} from "./chromium-cookies.js";

let scratch: string;
const keyring = vi.fn<(keystore: Keystore) => Promise<Buffer>>();

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-orchestrate-"));
  keyring.mockResolvedValue(Buffer.from(KEYRING_PASSWORD));
});

afterEach(async () => {
  keyring.mockReset();
  await rm(scratch, { recursive: true, force: true });
});

/** A session cookie whose value names the password it was encrypted under. */
function v10Session(lastAccess: bigint): Row {
  const encrypted = encrypt("peanuts", { prefix: "v10", key: PEANUTS });
  return { host: "ankiweb.net", name: "ankiweb", encrypted, lastAccess };
}

function v11Session(lastAccess: bigint): Row {
  const encrypted = encrypt(KEYRING_PASSWORD, { prefix: "v11", key: key(KEYRING_PASSWORD, 1) });
  return { host: "ankiweb.net", name: "ankiweb", encrypted, lastAccess };
}

describe("browser import", () => {
  it("ranks without touching a keystore and gives up when nothing is live", async () => {
    expect.assertions(2);
    const expired = await writeCookiesDb(scratch, {
      name: "expired",
      version: 23,
      rows: [{ ...v11Session(EARLIER), expires: EARLIER }],
    });
    const appBound = await writeCookiesDb(scratch, {
      name: "v20",
      version: 23,
      rows: [{ host: "ankiweb.net", name: "ankiweb", encrypted: Buffer.from("v20xyz") }],
    });
    const adopt = vi.fn<(cookies: readonly StoredCookie[]) => Promise<boolean>>();
    await expect(
      importFromBrowser(undefined, adopt, {
        discover: async () => [expired, appBound],
        readPassword: keyring,
        now: NOW,
      }),
    ).rejects.toThrow(BrowserImportError);
    expect(keyring).not.toHaveBeenCalled();
  });

  it("names the account being signed in when nothing is found for it", async () => {
    expect.assertions(1);
    const adopt = vi.fn<(cookies: readonly StoredCookie[]) => Promise<boolean>>();
    await expect(
      importFromBrowser("brave", adopt, { discover: async () => [], account: "work" }),
    ).rejects.toThrow("anki-web-mcp --login --account work");
  });

  it("tries the most recently used profile first and falls through a rejection", async () => {
    expect.assertions(3);
    const older = await writeCookiesDb(scratch, {
      name: "older",
      version: 23,
      rows: [v10Session(EARLIER)],
    });
    const newer = await writeCookiesDb(scratch, {
      name: "newer",
      version: 23,
      rows: [v11Session(chromiumTime(NOW))],
    });
    const adopt = vi.fn<(cookies: readonly StoredCookie[]) => Promise<boolean>>();
    adopt.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const kept = await importFromBrowser(undefined, adopt, {
      discover: async () => [older, newer],
      readPassword: keyring,
      now: NOW,
    });
    expect(kept).toBe("older");
    expect(
      adopt.mock.calls.map(([cookies]: readonly [readonly StoredCookie[]]) => cookies[0]?.value),
    ).toStrictEqual([KEYRING_PASSWORD, "peanuts"]);
    expect(keyring).toHaveBeenCalledOnce();
  });
});
