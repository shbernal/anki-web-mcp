import { McpServer } from "@modelcontextprotocol/server";

import type { BrowserSession } from "./browser/session.js";
import type { DataDir } from "./data-dir.js";
import { registerServerStatus } from "./tools/server-status.js";
import { version } from "./version.js";

export interface ServerOptions {
  readonly dataDir: DataDir;
  readonly session: BrowserSession;
}

export function createServer({ dataDir, session }: ServerOptions): McpServer {
  const server = new McpServer({ name: "anki-web-mcp", version });
  registerServerStatus(server, dataDir, session);
  return server;
}
