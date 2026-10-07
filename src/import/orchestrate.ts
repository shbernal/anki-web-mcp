/*
 * Picks a browser profile to import the session from. The ranking and the
 * try-each-in-turn flow are ported from linkedin-mcp-server and rewritten in
 * TypeScript (see NOTICE).
 */
import { type AdoptCookies, BrowserSession } from "../browser/session.js";
import { type AccountPaths, type DataDir, DEFAULT_ACCOUNT, loginCommand } from "../data-dir.js";
import { type BrowserName, type BrowserProfile, discoverProfiles } from "./discovery.js";
import { extractCookies, lastSessionUse, type ReadPassword } from "./extract.js";
import { readKeystorePassword } from "./keystore.js";

export interface ImportOptions {
  readonly discover?: (browser: BrowserName | undefined) => Promise<readonly BrowserProfile[]>;
  readonly readPassword?: ReadPassword;
  readonly now?: Date;
  /** The account being signed in, named in the advice when nothing is found. */
  readonly account?: string;
}

export class BrowserImportError extends Error {
  override name = "BrowserImportError";
}

export interface ImportSessionOptions {
  readonly dataDir: DataDir;
  readonly account: AccountPaths;
  /** Undefined tries every browser found. */
  readonly browser: BrowserName | undefined;
  readonly channel: string | undefined;
}

/**
 * `--import-from-browser`: brings a local browser's session into `account`,
 * through a browser of its own, and resolves to the label of the profile kept.
 */
export async function importSession({
  dataDir,
  account,
  browser,
  channel,
}: ImportSessionOptions): Promise<string> {
  const session = new BrowserSession({ dataDir, account, channel, holder: "import" });
  try {
    return await importFromBrowser(browser, (cookies) => session.adoptCookies(cookies), {
      account: account.name,
    });
  } finally {
    await session.close();
  }
}

/**
 * Finds the profiles holding a live AnkiWeb session, most recently used first,
 * and tries each until AnkiWeb accepts one. Only the profile being tried is
 * decrypted, so a macOS user sees at most one keychain prompt per browser tried.
 * Resolves to the label of the profile that was kept.
 */
export async function importFromBrowser(
  browser: BrowserName | undefined,
  adopt: AdoptCookies,
  options: ImportOptions = {},
): Promise<string> {
  const discover = options.discover ?? discoverProfiles;
  const readPassword = options.readPassword ?? readKeystorePassword;
  const candidates = await rankCandidates(await discover(browser), options.now ?? new Date());
  if (candidates.length === 0) {
    throw new BrowserImportError(
      `No ${browser ?? "Chromium-family browser"} profile holds a live AnkiWeb session. Sign in to AnkiWeb there first, or run \`${loginCommand(options.account ?? DEFAULT_ACCOUNT)}\`.`,
    );
  }
  const failures: string[] = [];
  for (const profile of candidates) {
    const failure = await tryProfile(profile, readPassword, adopt);
    if (failure === undefined) {
      return profile.label;
    }
    failures.push(`${profile.label}: ${failure}`);
  }
  throw new BrowserImportError(`No browser session could be imported:\n  ${failures.join("\n  ")}`);
}

/** Resolves to why `profile` could not be used, or to nothing once AnkiWeb accepted it. */
async function tryProfile(
  profile: Readonly<BrowserProfile>,
  readPassword: ReadPassword,
  adopt: AdoptCookies,
): Promise<string | undefined> {
  const cookies = await extractCookies(profile, readPassword).catch((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  );
  if (typeof cookies === "string") {
    return cookies;
  }
  return (await adopt(cookies)) ? undefined : "AnkiWeb rejected the session";
}

/** The profiles with a live session cookie, by when they last sent it, newest first. */
export async function rankCandidates(
  profiles: readonly BrowserProfile[],
  now: Readonly<Date>,
): Promise<readonly BrowserProfile[]> {
  // A database that cannot be copied or read rules out its profile, not the import.
  const uses = await Promise.allSettled(profiles.map((profile) => lastSessionUse(profile, now)));
  return profiles
    .flatMap((profile, index) => {
      const use = uses[index];
      return use?.status === "fulfilled" && use.value !== undefined
        ? [{ profile, lastUse: use.value } as const]
        : [];
    })
    .toSorted((first, second) => second.lastUse - first.lastUse)
    .map(({ profile }) => profile);
}
