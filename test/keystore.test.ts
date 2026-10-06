import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Keystore } from "../src/import/discovery.js";
import { CookieDecryptionError } from "../src/import/extract.js";
import { readKeystorePassword } from "../src/import/keystore.js";

const EXECUTABLE = 0o755;
const BRAVE: Keystore = { os: "linux", application: "brave", kwallet: "Brave" };

let scratch: string;
let path: string | undefined;

/** Puts a shell script named `name` on `PATH` that logs its arguments and runs `body`. */
async function stub(name: string, body: string): Promise<void> {
  const file = join(scratch, name);
  await writeFile(file, `#!/bin/sh\necho "${name} $*" >> "${scratch}/calls"\n${body}\n`);
  await chmod(file, EXECUTABLE);
}

async function calls(): Promise<string[]> {
  const log = await readFile(join(scratch, "calls"), "utf8");
  return log.trim().split("\n");
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-"));
  path = process.env.PATH;
  process.env.PATH = scratch;
});

afterEach(async () => {
  process.env.PATH = path;
  await rm(scratch, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("readKeystorePassword on Linux", () => {
  it("takes the Secret Service's key without asking KWallet", async () => {
    expect.assertions(2);
    await stub("secret-tool", "echo secret");
    await stub("kwallet-query", "echo wallet");
    await expect(readKeystorePassword(BRAVE)).resolves.toStrictEqual(Buffer.from("secret"));
    await expect(calls()).resolves.toStrictEqual(["secret-tool lookup application brave"]);
  });

  it("falls back to KWallet under the browser's product name", async () => {
    expect.assertions(2);
    await stub("secret-tool", "exit 1");
    await stub("kwallet-query", "echo wallet");
    await expect(readKeystorePassword(BRAVE)).resolves.toStrictEqual(Buffer.from("wallet"));
    await expect(calls()).resolves.toStrictEqual([
      "secret-tool lookup application brave",
      "kwallet-query --read-password Brave Safe Storage --folder Brave Keys kdewallet",
    ]);
  });

  it("reads KWallet's missing-entry message as no key, and names both stores", async () => {
    expect.assertions(2);
    await stub("secret-tool", "exit 1");
    await stub(
      "kwallet-query",
      "echo 'Failed to read entry Brave Safe Storage value from the kdewallet wallet.'",
    );
    const failure = readKeystorePassword(BRAVE);
    await expect(failure).rejects.toThrow(CookieDecryptionError);
    await expect(failure).rejects.toThrow(/secret-tool.*; `kwallet-query` has no cookie key/su);
  });
});
