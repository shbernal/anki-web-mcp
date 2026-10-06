/*
 * Reads and decrypts a Chromium cookie database. The format constants are
 * Chromium's own; the selection and decryption steps follow linkedin-mcp-server
 * (see NOTICE).
 */
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import {
  AUTH_COOKIE_NAMES,
  SESSION_COOKIE,
  SESSION_HOSTS,
  type StoredCookie,
} from "../browser/cookies.js";
import { unlessMissing } from "../data-dir.js";
import type { BrowserProfile, Keystore } from "./discovery.js";

const SALT = "saltysalt";
const KEY_BYTES = 16;
const LINUX_ITERATIONS = 1;
const MAC_ITERATIONS = 1003;
/** What Chromium on Linux encrypts `v10` values with when no keyring is in use. */
const LINUX_V10_PASSWORD = "peanuts";
const IV = Buffer.alloc(KEY_BYTES, " ");
const PREFIX_BYTES = 3;
/** From this `meta.version` on, the plaintext starts with SHA256(host_key). */
const HOST_DIGEST_VERSION = 24;
const HOST_DIGEST_BYTES = 32;
const WRONG_KEY = "the keystore password does not decrypt this profile";

/** Seconds between 1601-01-01, Chromium's epoch, and 1970-01-01. */
const CHROMIUM_EPOCH_OFFSET = 11_644_473_600n;
const MICROS_PER_SECOND = 1_000_000n;
const MS_PER_SECOND = 1000;
/** Playwright's `expires` for a cookie that lasts as long as the browser session. */
const SESSION_EXPIRY = -1;

const SAME_SITE: Readonly<Record<string, StoredCookie["sameSite"]>> = {
  "-1": "Lax",
  "0": "None",
  "1": "Lax",
  "2": "Strict",
};

/** Reads the password a profile's cookie key is derived from. */
export type ReadPassword = (keystore: Keystore) => Promise<Buffer>;

export class CookieDecryptionError extends Error {
  override name = "CookieDecryptionError";
}

const hosts = [...SESSION_HOSTS, ...SESSION_HOSTS.map((host) => `.${host}`)];

const candidateRowSchema = z.object({
  expires_utc: z.bigint(),
  last_access_utc: z.bigint(),
  encrypted_value: z.instanceof(Uint8Array),
  value: z.string(),
});

const cookieRowSchema = z.object({
  host_key: z.string(),
  name: z.string(),
  value: z.string(),
  encrypted_value: z.instanceof(Uint8Array),
  path: z.string(),
  expires_utc: z.bigint(),
  is_secure: z.bigint(),
  is_httponly: z.bigint(),
  samesite: z.bigint(),
});

type CookieRow = z.infer<typeof cookieRowSchema>;

/** Converts microseconds since 1601 to Unix seconds. */
export function chromiumTimeToUnix(micros: bigint): number {
  return Number(micros / MICROS_PER_SECOND - CHROMIUM_EPOCH_OFFSET);
}

export function sameSiteFromChromium(value: bigint): StoredCookie["sameSite"] {
  return SAME_SITE[String(value)] ?? "Lax";
}

/**
 * When `profile` last sent a live AnkiWeb session cookie, in Unix seconds, or
 * `undefined` if it holds none that is unexpired and decryptable. Reads only
 * plaintext columns, so it never touches a keystore.
 */
export async function lastSessionUse(
  profile: Readonly<BrowserProfile>,
  now: Readonly<Date>,
): Promise<number | undefined> {
  const rows = await readCopy(profile.cookiesDb, (db) =>
    db
      .prepare(
        `SELECT expires_utc, last_access_utc, encrypted_value, value FROM cookies
         WHERE name = ? AND host_key IN (?, ?)`,
      )
      .all(SESSION_COOKIE, "ankiweb.net", ".ankiweb.net"),
  );
  const nowSeconds = now.getTime() / MS_PER_SECOND;
  const uses = z
    .array(candidateRowSchema)
    .parse(rows)
    .filter(
      (row) =>
        (row.value !== "" || isDecryptable(row.encrypted_value)) &&
        (row.expires_utc === 0n || chromiumTimeToUnix(row.expires_utc) > nowSeconds),
    )
    .map((row) => chromiumTimeToUnix(row.last_access_utc));
  return uses.length === 0 ? undefined : Math.max(...uses);
}

/** Decrypts `profile`'s AnkiWeb auth cookies into the shape Playwright's `addCookies` takes. */
export async function extractCookies(
  profile: Readonly<BrowserProfile>,
  readPassword: ReadPassword,
): Promise<readonly StoredCookie[]> {
  const { version, rows } = await readCopy(profile.cookiesDb, (db) => ({
    version: metaVersion(db),
    rows: z.array(cookieRowSchema).parse(
      db
        .prepare(
          `SELECT host_key, name, value, encrypted_value, path, expires_utc,
                  is_secure, is_httponly, samesite
           FROM cookies WHERE name IN (?, ?) AND host_key IN (?, ?, ?, ?)`,
        )
        .all(...AUTH_COOKIE_NAMES, ...hosts),
    ),
  }));
  const keys = new Map<string, Buffer>();
  const keyFor = async (prefix: string): Promise<Buffer> => {
    const cached = keys.get(prefix);
    if (cached !== undefined) {
      return cached;
    }
    const key = await deriveKey(prefix, profile.keystore, readPassword);
    keys.set(prefix, key);
    return key;
  };
  const cookies: StoredCookie[] = [];
  for (const row of rows) {
    const value =
      row.value === ""
        ? decryptValue(
            row.encrypted_value,
            await keyFor(prefixOf(row.encrypted_value)),
            version >= HOST_DIGEST_VERSION ? row.host_key : undefined,
          )
        : row.value;
    cookies.push(toPlaywright(row, value));
  }
  return cookies;
}

/**
 * AES-128-CBC with Chromium's fixed IV, then PKCS7 unpadding. From store
 * version 24 on, the plaintext opens with SHA256(host_key): pass `digestHost`
 * for those, and the digest doubles as the check that the key was right.
 */
export function decryptValue(
  blob: Readonly<Uint8Array>,
  key: Readonly<Buffer>,
  digestHost: string | undefined,
): string {
  if (!isDecryptable(blob)) {
    throw new CookieDecryptionError(`unsupported cookie encryption "${prefixOf(blob)}"`);
  }
  const plaintext = decryptCbc(blob.subarray(PREFIX_BYTES), key);
  if (digestHost === undefined) {
    return plaintext.toString("utf8");
  }
  const digest = createHash("sha256").update(digestHost).digest();
  if (!plaintext.subarray(0, HOST_DIGEST_BYTES).equals(digest)) {
    throw new CookieDecryptionError(WRONG_KEY);
  }
  return plaintext.subarray(HOST_DIGEST_BYTES).toString("utf8");
}

function decryptCbc(ciphertext: Readonly<Uint8Array>, key: Readonly<Buffer>): Buffer {
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, IV);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    // A wrong key almost always shows up as bad padding.
    throw new CookieDecryptionError(WRONG_KEY, { cause: error });
  }
}

/**
 * On Linux `v10` always uses the built-in password and `v11` the keyring's;
 * macOS writes `v10` with the keychain's.
 */
async function deriveKey(
  prefix: string,
  keystore: Keystore,
  readPassword: ReadPassword,
): Promise<Buffer> {
  if (keystore.os === "linux") {
    const password = prefix === "v10" ? LINUX_V10_PASSWORD : await readPassword(keystore);
    return pbkdf2Sync(password, SALT, LINUX_ITERATIONS, KEY_BYTES, "sha1");
  }
  return pbkdf2Sync(await readPassword(keystore), SALT, MAC_ITERATIONS, KEY_BYTES, "sha1");
}

function toPlaywright(row: CookieRow, value: string): StoredCookie {
  return {
    name: row.name,
    value,
    domain: row.host_key,
    path: row.path,
    expires: row.expires_utc === 0n ? SESSION_EXPIRY : chromiumTimeToUnix(row.expires_utc),
    httpOnly: row.is_httponly !== 0n,
    secure: row.is_secure !== 0n,
    sameSite: sameSiteFromChromium(row.samesite),
  };
}

function prefixOf(blob: Readonly<Uint8Array>): string {
  return Buffer.from(blob.subarray(0, PREFIX_BYTES)).toString("latin1");
}

/** `v20` is app-bound encryption, which needs OS elevation to undo. */
function isDecryptable(blob: Readonly<Uint8Array>): boolean {
  const prefix = prefixOf(blob);
  return prefix === "v10" || prefix === "v11";
}

function metaVersion(db: DatabaseSync): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'version'").get();
  const version = Number(row?.value);
  return Number.isInteger(version) ? version : 0;
}

/**
 * Copies the database with its `-wal` and `-shm` beside it, since the browser
 * holds a lock on the live one and recent writes may still sit in the WAL, then
 * reads the copy and deletes it.
 */
async function readCopy<Result>(
  cookiesDb: string,
  read: (db: DatabaseSync) => Result,
): Promise<Result> {
  // `mkdtemp` creates the directory 0700.
  const dir = await mkdtemp(join(tmpdir(), "anki-web-mcp-cookies-"));
  try {
    const copy = join(dir, "Cookies");
    await copyFile(cookiesDb, copy);
    for (const suffix of ["-wal", "-shm"]) {
      await unlessMissing(copyFile(`${cookiesDb}${suffix}`, `${copy}${suffix}`));
    }
    const db = new DatabaseSync(copy, { readOnly: true, readBigInts: true });
    try {
      return read(db);
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
