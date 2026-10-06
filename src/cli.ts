#!/usr/bin/env node
import { once } from "node:events";
import { parseArgs } from "node:util";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

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
    const server = createServer({ dataDir, session });
    await server.connect(new StdioServerTransport());
    console.error("anki-web-mcp: serving on stdio");
    // The transport does not notice the client going away, and an open browser
    // would keep the process alive after it has.
    await once(process.stdin, "end");
    await server.close();
    await session.close();
  }
} catch (error) {
  console.error(`anki-web-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
