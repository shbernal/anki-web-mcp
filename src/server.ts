import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerServerStatus } from "./tools/server-status.js";
import { version } from "./version.js";

export function createServer(): McpServer {
  const server = new McpServer({ name: "anki-web-mcp", version });
  registerServerStatus(server);
  return server;
}
