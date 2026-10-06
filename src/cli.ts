#!/usr/bin/env node
import { parseArgs } from "node:util";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./server.js";

const { values } = parseArgs({
  options: {
    login: { type: "boolean" },
    logout: { type: "boolean" },
    "import-from-browser": { type: "boolean" },
  },
  strict: true,
});

const pending = (["login", "logout", "import-from-browser"] as const).find(
  (flag) => values[flag] === true,
);

if (pending === undefined) {
  // Stdout carries the protocol, so anything human-readable goes to stderr.
  await createServer().connect(new StdioServerTransport());
  console.error("anki-web-mcp: serving on stdio");
} else {
  console.error(`anki-web-mcp: --${pending} is not implemented yet`);
  process.exitCode = 1;
}
