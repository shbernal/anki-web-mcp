#!/usr/bin/env node
import { once } from "node:events";
import { parseArgs } from "node:util";

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { installBrowser } from "./browser/launch.js";
import { login } from "./browser/login.js";
import { BrowserSession } from "./browser/session.js";
import { removeSession, resolveDataDir } from "./data-dir.js";
import { BROWSER_NAMES, type BrowserName, isBrowserName } from "./import/discovery.js";
import { importFromBrowser } from "./import/orchestrate.js";
import { createServer } from "./server.js";

/** `node` and the script path come first. */
const ARGV_OFFSET = 2;
const IMPORT_FLAG = "--import-from-browser";
const AUTO = "auto";

/** Lets `--import-from-browser` stand alone, meaning `auto`, which `parseArgs` cannot express. */
function withImportDefault(args: readonly string[]): readonly string[] {
  return args.flatMap((arg, index) => {
    const next = args[index + 1];
    return arg === IMPORT_FLAG && (next === undefined || next.startsWith("-"))
      ? [arg, AUTO]
      : [arg];
  });
}

function browserFlag(value: string): BrowserName | undefined {
  if (value === AUTO) {
    return undefined;
  }
  if (!isBrowserName(value)) {
    throw new Error(`${IMPORT_FLAG} takes ${AUTO} or one of: ${BROWSER_NAMES.join(", ")}`);
  }
  return value;
}

const { values } = parseArgs({
  args: [...withImportDefault(process.argv.slice(ARGV_OFFSET))],
  options: {
    login: { type: "boolean" },
    logout: { type: "boolean" },
    "import-from-browser": { type: "string" },
    "auto-import": { type: "boolean", default: true },
    "install-browser": { type: "boolean" },
    "data-dir": { type: "string" },
    channel: { type: "string" },
  },
  allowNegative: true,
  strict: true,
});

const dataDir = resolveDataDir(values["data-dir"]);
const { channel } = values;
const importFrom = values["import-from-browser"];

async function importSession(browser: BrowserName | undefined): Promise<void> {
  const session = new BrowserSession({ dataDir, channel });
  try {
    const label = await importFromBrowser(browser, (cookies) => session.adoptCookies(cookies));
    console.error(`anki-web-mcp: imported the session from ${label}; stored in ${dataDir.root}`);
  } finally {
    await session.close();
  }
}

async function serve(): Promise<void> {
  const session = new BrowserSession({
    dataDir,
    channel,
    autoImport: values["auto-import"] ? (adopt) => importFromBrowser(undefined, adopt) : undefined,
  });
  const handle = serveStdio(() => createServer({ dataDir, session }));
  console.error("anki-web-mcp: serving on stdio");
  // The transport closes itself when the client hangs up, but an open browser
  // would still keep the process alive. The browser is shared rather than
  // released from each server's onclose, because serveStdio also builds and
  // closes throwaway instances for server/discover probes.
  await Promise.race([once(process.stdin, "end"), once(process.stdin, "close")]);
  await handle.close();
  await session.close();
}

// Stdout carries the protocol, so anything human-readable goes to stderr.
try {
  if (values["install-browser"] === true) {
    process.exitCode = await installBrowser();
  } else if (values.login === true) {
    await login(dataDir, channel);
  } else if (values.logout === true) {
    await removeSession(dataDir);
    console.error(`anki-web-mcp: session removed from ${dataDir.root}`);
  } else if (importFrom === undefined) {
    await serve();
  } else {
    await importSession(browserFlag(importFrom));
  }
} catch (error) {
  console.error(`anki-web-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
