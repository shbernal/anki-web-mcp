import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Keystore } from "./discovery.js";
import { CookieDecryptionError } from "./extract.js";

/** Long enough to answer a macOS keychain prompt, short enough not to hang a tool call. */
const KEYSTORE_TIMEOUT_MS = 10_000;

// `execFile` returns the child process as well as calling back, and Node
// documents `promisify` on it as the way to get the promise form.
// oxlint-disable-next-line typescript/strict-void-return
const run = promisify(execFile);

/** Asks the OS keystore, which on macOS shows one keychain prompt. */
export async function readKeystorePassword(keystore: Keystore): Promise<Buffer> {
  const [command, args] =
    keystore.os === "linux"
      ? ["secret-tool", ["lookup", "application", keystore.application]]
      : [
          "security",
          ["find-generic-password", "-w", "-s", keystore.service, "-a", keystore.account],
        ];
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
  if (password === "") {
    throw new CookieDecryptionError(`\`${command}\` has no cookie key for this browser`);
  }
  return Buffer.from(password, "utf8");
}
