import { McpServer } from "@modelcontextprotocol/server";

import { SharedDecks } from "./ankiweb/shared.js";
import type { BrowserSession } from "./browser/session.js";
import type { DataDir } from "./data-dir.js";
import { registerTools } from "./tools/index.js";
import type { PollOptions } from "./tools/share.js";
import { version } from "./version.js";

export interface ServerOptions {
  readonly dataDir: DataDir;
  readonly session: BrowserSession;
  /** Defaults to a live one; it caches what AnkiWeb lets it for the server's lifetime. */
  readonly sharedDecks?: SharedDecks;
  /** How `share_deck` waits on AnkiWeb after submitting. */
  readonly sharePoll?: PollOptions;
}

export function createServer({
  dataDir,
  session,
  sharedDecks = new SharedDecks(),
  sharePoll,
}: ServerOptions): McpServer {
  const server = new McpServer({ name: "anki-web-mcp", version });
  registerTools(server, { dataDir, session, sharedDecks, sharePoll });
  return server;
}
