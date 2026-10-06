#!/usr/bin/env node
import { once } from "node:events";
import { parseArgs } from "node:util";

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { installBrowser } from "./browser/launch.js";
import { login } from "./browser/login.js";
import { BrowserSession } from "./browser/session.js";
import { removeSession, resolveDataDir } from "./data-dir.js";
import { createServer } from "./server.js";

const { values } = parseArgs({
  options: {
    login: { type: "boolean" },
    logout: { type: "boolean" },
    "import-from-browser": { type: "boolean" },
    "install-browser": { type: "boolean" },
    "data-dir": { type: "string" },
    channel: { type: "string" },
  },
  strict: true,
});

const dataDir = resolveDataDir(values["data-dir"]);
const { channel } = values;

// Stdout carries the protocol, so anything human-readable goes to stderr.
try {
  if (values["install-browser"] === true) {
    process.exitCode = await installBrowser();
  } else if (values.login === true) {
    await login(dataDir, channel);
  } else if (values.logout === true) {
    await removeSession(dataDir);
    console.error(`anki-web-mcp: session removed from ${dataDir.root}`);
  } else if (values["import-from-browser"] === true) {
    console.error("anki-web-mcp: --import-from-browser is not implemented yet");
    process.exitCode = 1;
  } else {
    const session = new BrowserSession({ dataDir, channel });
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
} catch (error) {
  console.error(`anki-web-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
