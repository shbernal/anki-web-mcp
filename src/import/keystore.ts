import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Keystore } from "./discovery.js";
import { CookieDecryptionError } from "./extract.js";

/** Long enough to answer a macOS keychain prompt, short enough not to hang a tool call. */
const KEYSTORE_TIMEOUT_MS = 10_000;
/** The wallet KDE creates and Chromium writes to unless told otherwise. */
const KDE_WALLET = "kdewallet";
/** What `kwallet-query` prints, exiting 0, when the wallet has no such entry. */
const KWALLET_MISSING = /^failed to read/iu;

// `execFile` returns the child process as well as calling back, and Node
// documents `promisify` on it as the way to get the promise form.
// oxlint-disable-next-line typescript/strict-void-return
const run = promisify(execFile);

type Command = readonly [string, readonly string[]];

/** Resolves to the password `command` prints, or rejects saying why there is none. */
async function readPassword([command, args]: Command): Promise<Buffer> {
  let stdout = "";
  try {
    ({ stdout } = await run(command, args, { timeout: KEYSTORE_TIMEOUT_MS }));
  } catch (error) {
    throw new CookieDecryptionError(
      `could not read the cookie key from \`${command}\`: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const password = stdout.replace(/\n$/u, "");
  if (password === "" || KWALLET_MISSING.test(password)) {
    throw new CookieDecryptionError(`\`${command}\` has no cookie key for this browser`);
  }
  return Buffer.from(password, "utf8");
}

/**
 * Where to ask, in order. On Linux Chromium keeps the key in the Secret Service
 * (GNOME Keyring, KeePassXC) or, on KDE, in KWallet; trying KWallet second
 * leaves a Secret Service user with one call, as before.
 */
function commands(keystore: Keystore): readonly Command[] {
  if (keystore.os === "darwin") {
    return [
      ["security", ["find-generic-password", "-w", "-s", keystore.service, "-a", keystore.account]],
    ];
  }
  return [
    ["secret-tool", ["lookup", "application", keystore.application]],
    [
      "kwallet-query",
      [
        "--read-password",
        `${keystore.kwallet} Safe Storage`,
        "--folder",
        `${keystore.kwallet} Keys`,
        KDE_WALLET,
      ],
    ],
  ];
}

/** Asks the OS keystore, which on macOS shows one keychain prompt. */
export async function readKeystorePassword(keystore: Keystore): Promise<Buffer> {
  const reasons: string[] = [];
  for (const command of commands(keystore)) {
    try {
      return await readPassword(command);
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new CookieDecryptionError(reasons.join("; "));
}
