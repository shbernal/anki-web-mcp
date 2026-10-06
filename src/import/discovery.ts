/*
 * Where Chromium-family browsers keep their profiles and cookie keys. The list
 * is ported from linkedin-mcp-server and rewritten in TypeScript (see NOTICE).
 */
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

/** Where a browser keeps the password its cookie key is derived from. */
export type Keystore =
  | { readonly os: "linux"; readonly application: string }
  | { readonly os: "darwin"; readonly service: string; readonly account: string };

interface BrowserSpec {
  readonly label: string;
  /** Under `~/Library/Application Support`. */
  readonly mac?: { readonly path: string; readonly service: string; readonly account: string };
  /** Under `$XDG_CONFIG_HOME`, with the `secret-tool` application token. */
  readonly linux?: { readonly path: string; readonly application: string };
  /** Opera keeps its one profile at the user-data root rather than in `Default/`. */
  readonly flat?: true;
}

/** Paths and keystore names as Chromium and each fork spell them. */
const BROWSERS = {
  chrome: {
    label: "Google Chrome",
    mac: { path: "Google/Chrome", service: "Chrome Safe Storage", account: "Chrome" },
    linux: { path: "google-chrome", application: "chrome" },
  },
  chromium: {
    label: "Chromium",
    mac: { path: "Chromium", service: "Chromium Safe Storage", account: "Chromium" },
    linux: { path: "chromium", application: "chromium" },
  },
  brave: {
    label: "Brave",
    mac: { path: "BraveSoftware/Brave-Browser", service: "Brave Safe Storage", account: "Brave" },
    linux: { path: "BraveSoftware/Brave-Browser", application: "brave" },
  },
  edge: {
    label: "Microsoft Edge",
    mac: {
      path: "Microsoft Edge",
      service: "Microsoft Edge Safe Storage",
      account: "Microsoft Edge",
    },
    linux: { path: "microsoft-edge", application: "microsoft-edge" },
  },
  vivaldi: {
    label: "Vivaldi",
    mac: { path: "Vivaldi", service: "Vivaldi Safe Storage", account: "Vivaldi" },
    linux: { path: "vivaldi", application: "vivaldi" },
  },
  opera: {
    label: "Opera",
    mac: { path: "com.operasoftware.Opera", service: "Opera Safe Storage", account: "Opera" },
    linux: { path: "opera", application: "opera" },
    flat: true,
  },
  // No Linux build of either.
  arc: {
    label: "Arc",
    mac: { path: "Arc/User Data", service: "Arc Safe Storage", account: "Arc" },
  },
  // Helium renames the keychain service but keeps the product name as account.
  helium: {
    label: "Helium",
    mac: { path: "net.imput.helium", service: "Helium Storage Key", account: "Helium" },
  },
} as const satisfies Record<string, BrowserSpec>;

export type BrowserName = keyof typeof BROWSERS;
export function isBrowserName(name: string): name is BrowserName {
  return Object.hasOwn(BROWSERS, name);
}

export const BROWSER_NAMES: readonly BrowserName[] = Object.keys(BROWSERS).filter((name) =>
  isBrowserName(name),
);

export interface BrowserProfile {
  readonly browser: BrowserName;
  /** `Google Chrome / Profile 1`, for messages. */
  readonly label: string;
  readonly cookiesDb: string;
  readonly keystore: Keystore;
}

export interface DiscoveryOptions {
  readonly platform?: NodeJS.Platform;
  readonly home?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

type Host = Required<DiscoveryOptions>;

const PROFILE_DIR = /^(?:Default|Profile \d+)$/u;
const ABSENT = new Set(["ENOENT", "ENOTDIR"]);

/**
 * Lists every profile with a cookie database, for `browser` or for all known
 * browsers. Pure file I/O: nothing here opens a database or a keystore.
 */
export async function discoverProfiles(
  browser: BrowserName | undefined,
  options: DiscoveryOptions = {},
): Promise<readonly BrowserProfile[]> {
  const host: Host = {
    platform: options.platform ?? process.platform,
    home: options.home ?? homedir(),
    env: options.env ?? process.env,
  };
  const profiles: BrowserProfile[] = [];
  for (const name of browser === undefined ? BROWSER_NAMES : [browser]) {
    const location = locate(BROWSERS[name], host);
    if (location !== undefined) {
      profiles.push(...(await browserProfiles(name, location)));
    }
  }
  return profiles;
}

interface Location {
  readonly root: string;
  readonly keystore: Keystore;
}

async function browserProfiles(
  browser: BrowserName,
  { root, keystore }: Location,
): Promise<readonly BrowserProfile[]> {
  const spec: BrowserSpec = BROWSERS[browser];
  const profiles: BrowserProfile[] = [];
  for (const channel of await channelRoots(root)) {
    for (const [dir, cookiesDb] of await profileCookies(channel, spec.flat === true)) {
      profiles.push({ browser, label: `${spec.label} / ${dir}`, cookiesDb, keystore });
    }
  }
  return profiles;
}

function locate(spec: BrowserSpec, { platform, home, env }: Host): Location | undefined {
  if (platform === "darwin" && spec.mac !== undefined) {
    const { path, service, account } = spec.mac;
    return {
      root: join(home, "Library", "Application Support", path),
      keystore: { os: "darwin", service, account },
    };
  }
  if (platform === "linux" && spec.linux !== undefined) {
    const config = env.XDG_CONFIG_HOME ?? join(home, ".config");
    return {
      root: join(config, spec.linux.path),
      keystore: { os: "linux", application: spec.linux.application },
    };
  }
  return undefined;
}

/** The stable root plus its siblings, such as `google-chrome-beta` or `Brave-Browser-Nightly`. */
async function channelRoots(root: string): Promise<readonly string[]> {
  const parent = dirname(root);
  const prefix = basename(root);
  const names = await entries(parent);
  return names
    .filter((name) => name.startsWith(prefix))
    .map((name) => join(parent, name))
    .toSorted();
}

async function profileCookies(
  root: string,
  flat: boolean,
): Promise<readonly (readonly [string, string])[]> {
  const names = flat ? ["."] : await entries(root);
  const dirs = flat ? names : names.filter((name) => PROFILE_DIR.test(name));
  const found: (readonly [string, string])[] = [];
  for (const dir of dirs.toSorted()) {
    const cookiesDb = await cookiesPath(join(root, dir));
    if (cookiesDb !== undefined) {
      found.push([flat ? basename(root) : dir, cookiesDb]);
    }
  }
  return found;
}

/** Newer builds keep the database under `Network/`, older ones beside `Preferences`. */
async function cookiesPath(profileDir: string): Promise<string | undefined> {
  for (const candidate of [join(profileDir, "Network", "Cookies"), join(profileDir, "Cookies")]) {
    const stats = await unlessAbsent(stat(candidate));
    if (stats?.isFile() === true) {
      return candidate;
    }
  }
  return undefined;
}

/** A directory's names, or none when it is missing or turns out to be a file. */
async function entries(dir: string): Promise<readonly string[]> {
  return (await unlessAbsent(readdir(dir))) ?? [];
}

/**
 * Like `unlessMissing`, but also for a path through something that is not a
 * directory: whatever sits under `~/.config` is not ours to vouch for.
 */
async function unlessAbsent<Result>(operation: Promise<Result>): Promise<Result | undefined> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof Error && "code" in error && ABSENT.has(String(error.code))) {
      return undefined;
    }
    throw error;
  }
}
