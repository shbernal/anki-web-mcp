import { readFile, rename, writeFile } from "node:fs/promises";

import type { Cookie } from "playwright";
import { z } from "zod";

import { unlessMissing } from "../data-dir.js";

const PRIVATE_FILE_MODE = 0o600;
const JSON_INDENT = 2;

/** The hosts that set the session; `ankiuser.net` mirrors it for the note editor. */
export const SESSION_URLS = ["https://ankiweb.net", "https://ankiuser.net"] as const;
export const SESSION_HOSTS = ["ankiweb.net", "ankiuser.net"] as const;
/** Matches a cookie domain on either session host, host-only or with a leading dot. */
export const SESSION_DOMAIN_PATTERN = /^\.?(?:ankiweb|ankiuser)\.net$/u;
export const SESSION_COOKIE = "ankiweb";
export const AUTH_COOKIE_NAMES = [SESSION_COOKIE, "has_auth"] as const;
const SESSION_DOMAINS = new Set<string>(SESSION_HOSTS);
const AUTH_COOKIES = new Set<string>(AUTH_COOKIE_NAMES);

const cookieSchema = z
  .object({
    name: z.string(),
    value: z.string(),
    domain: z.string(),
    path: z.string(),
    expires: z.number(),
    httpOnly: z.boolean(),
    secure: z.boolean(),
    sameSite: z.enum(["Strict", "Lax", "None"]),
  })
  .readonly();

const storedSessionSchema = z
  .object({
    validatedAt: z.iso.datetime(),
    cookies: z.array(cookieSchema).readonly(),
  })
  .readonly();

export type StoredCookie = z.infer<typeof cookieSchema>;
export type StoredSession = z.infer<typeof storedSessionSchema>;

function bareDomain(domain: string): string {
  return domain.startsWith(".") ? domain.slice(1) : domain;
}

/** Keeps the auth cookies, dropping analytics and anything set by other hosts. */
export function authCookies(cookies: readonly Readonly<Cookie>[]): readonly StoredCookie[] {
  return cookies
    .filter(
      (cookie) => AUTH_COOKIES.has(cookie.name) && SESSION_DOMAINS.has(bareDomain(cookie.domain)),
    )
    .map(({ name, value, domain, path, expires, httpOnly, secure, sameSite }) => ({
      name,
      value,
      domain,
      path,
      expires,
      httpOnly,
      secure,
      sameSite,
    }));
}

/** `ankiweb` on `ankiweb.net` alone is enough for every session-only call. */
export function hasSessionCookie(cookies: readonly Readonly<Cookie>[]): boolean {
  return cookies.some(
    (cookie) => cookie.name === SESSION_COOKIE && bareDomain(cookie.domain) === "ankiweb.net",
  );
}

export async function readStoredSession(path: string): Promise<StoredSession | undefined> {
  const text = await unlessMissing(readFile(path, "utf8"));
  return text === undefined ? undefined : storedSessionSchema.parse(JSON.parse(text));
}

/** Writes through a temporary file so a crash never leaves half a session behind. */
export async function writeStoredSession(path: string, session: StoredSession): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(session, undefined, JSON_INDENT)}\n`, {
    mode: PRIVATE_FILE_MODE,
  });
  await rename(temporary, path);
}
