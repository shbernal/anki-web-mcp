#!/usr/bin/env node
import { once } from "node:events";
import { parseArgs } from "node:util";

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { installBrowser } from "./browser/launch.js";
import { login, logout } from "./browser/login.js";
import { BrowserSession } from "./browser/session.js";
import { resolveDataDir } from "./data-dir.js";
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

const USAGE = `Usage: anki-web-mcp [options]

Serves MCP over stdio unless one of the first four options is given.

  --login                       sign in to AnkiWeb in a visible browser window
  --logout                      delete the stored session, keeping downloads
  --import-from-browser [name]  import the session from a local browser now
  --install-browser             download Playwright's Chromium
  --no-auto-import              never look in local browsers on its own
  --channel <name>              drive an installed browser, such as chrome
  --data-dir <path>             keep the session elsewhere; also ANKI_WEB_MCP_DATA_DIR
  -h, --help                    show this help`;

/** What the shell sees for a command line this CLI cannot run, as `sysexits` and most CLIs spell it. */
const USAGE_EXIT_CODE = 2;

/** A command line that cannot be run as given, reported in one line rather than a stack. */
class UsageError extends Error {
  override name = "UsageError";
}

function browserFlag(value: string): BrowserName | undefined {
  if (value === AUTO) {
    return undefined;
  }
  if (!isBrowserName(value)) {
    throw new UsageError(`${IMPORT_FLAG} takes ${AUTO} or one of: ${BROWSER_NAMES.join(", ")}`);
  }
  return value;
}

function exitWithUsage(message: string): never {
  console.error(`anki-web-mcp: ${message}`);
  console.error("Run `anki-web-mcp --help` for the options.");
  process.exit(USAGE_EXIT_CODE);
}

function parseCommandLine(args: readonly string[]) {
  try {
    return parseArgs({
      args: [...withImportDefault(args)],
      options: {
        login: { type: "boolean" },
        logout: { type: "boolean" },
        "import-from-browser": { type: "string" },
        "auto-import": { type: "boolean", default: true },
        "install-browser": { type: "boolean" },
        "data-dir": { type: "string" },
        channel: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      allowNegative: true,
      strict: true,
    }).values;
  } catch (error) {
    // `parseArgs` throws a plain `TypeError` with an `ERR_PARSE_ARGS_*` code.
    if (
      error instanceof TypeError &&
      "code" in error &&
      String(error.code).startsWith("ERR_PARSE_ARGS_")
    ) {
      exitWithUsage(error.message);
    }
    throw error;
  }
}

const values = parseCommandLine(process.argv.slice(ARGV_OFFSET));
const dataDir = resolveDataDir(values["data-dir"]);
const { channel } = values;
const importFrom = values["import-from-browser"];

async function importSession(browser: BrowserName | undefined): Promise<void> {
  const session = new BrowserSession({ dataDir, channel, holder: "import" });
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
  if (values.help === true) {
    process.stdout.write(`${USAGE}\n`);
  } else if (values["install-browser"] === true) {
    process.exitCode = await installBrowser();
  } else if (values.login === true) {
    await login(dataDir, channel);
  } else if (values.logout === true) {
    await logout(dataDir);
    console.error(`anki-web-mcp: session removed from ${dataDir.root}`);
  } else if (importFrom === undefined) {
    await serve();
  } else {
    await importSession(browserFlag(importFrom));
  }
} catch (error) {
  if (error instanceof UsageError) {
    exitWithUsage(error.message);
  }
  console.error(`anki-web-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
