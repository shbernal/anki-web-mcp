import { createCipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { BrowserProfile, Keystore } from "../src/import/discovery.js";

export const LINUX: Keystore = { os: "linux", application: "chrome", kwallet: "Chrome" };
export const MAC: Keystore = { os: "darwin", service: "Chrome Safe Storage", account: "Chrome" };
export const KEYRING_PASSWORD = "keyring-secret";
export const NOW = new Date("2026-10-06T12:00:00Z");

const EPOCH_OFFSET = 11_644_473_600n;

export function chromiumTime(date: Readonly<Date>): bigint {
  return (BigInt(date.getTime() / 1000) + EPOCH_OFFSET) * 1_000_000n;
}

export const LATER = chromiumTime(new Date("2027-01-01T00:00:00Z"));
export const EARLIER = chromiumTime(new Date("2026-01-01T00:00:00Z"));

export function key(password: string, iterations: number): Buffer {
  return pbkdf2Sync(password, "saltysalt", iterations, 16, "sha1");
}

export const PEANUTS = key("peanuts", 1);

interface Encryption {
  readonly prefix: "v10" | "v11";
  readonly key: Readonly<Buffer>;
  /** Prepends SHA256 of this host, as store version 24 on does. */
  readonly digestHost?: string;
}

/** Encrypts the way Chromium does on Linux and macOS. */
export function encrypt(
  plaintext: string,
  { prefix, key: withKey, digestHost }: Encryption,
): Buffer {
  const cipher = createCipheriv("aes-128-cbc", withKey, Buffer.alloc(16, " "));
  const digest =
    digestHost === undefined ? Buffer.alloc(0) : createHash("sha256").update(digestHost).digest();
  const padded = Buffer.concat([digest, Buffer.from(plaintext, "utf8")]);
  return Buffer.concat([Buffer.from(prefix, "latin1"), cipher.update(padded), cipher.final()]);
}

export interface Row {
  readonly host: string;
  readonly name: string;
  readonly encrypted: Readonly<Buffer>;
  readonly expires?: bigint;
  readonly lastAccess?: bigint;
  readonly sameSite?: number;
}

export interface CookiesDb {
  /** Also the profile's label. */
  readonly name: string;
  readonly version: number;
  readonly rows: readonly Row[];
  readonly keystore?: Keystore;
}

/** Writes a cookie database holding the columns the import reads, under `root/name/`. */
export async function writeCookiesDb(
  root: string,
  { name, version, rows, keystore = LINUX }: CookiesDb,
): Promise<BrowserProfile> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "Cookies");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE cookies (
      host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT,
      expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER,
      last_access_utc INTEGER, samesite INTEGER
    );
  `);
  db.prepare("INSERT INTO meta VALUES ('version', ?)").run(String(version));
  const insert = db.prepare("INSERT INTO cookies VALUES (?, ?, '', ?, '/', ?, 1, 1, ?, ?)");
  for (const row of rows) {
    insert.run(
      row.host,
      row.name,
      row.encrypted,
      row.expires ?? LATER,
      row.lastAccess ?? EARLIER,
      row.sameSite ?? -1,
    );
  }
  db.close();
  return { browser: "chrome", label: name, cookiesDb: path, keystore };
}
