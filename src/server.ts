import { McpServer } from "@modelcontextprotocol/server";

import { SharedDecks } from "./ankiweb/shared.js";
import type { BrowserSession } from "./browser/session.js";
import type { DataDir } from "./data-dir.js";
import { registerDownload } from "./tools/download.js";
import { registerMyDecks } from "./tools/my-decks.js";
import { registerServerStatus } from "./tools/server-status.js";
import { type PollOptions, registerShare } from "./tools/share.js";
import { registerSharedDecks } from "./tools/shared.js";
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
  registerServerStatus(server, dataDir, session);
  registerSharedDecks(server, sharedDecks);
  registerDownload(server, { shared: sharedDecks, session, dataDir });
  registerMyDecks(server, session);
  registerShare(server, session, sharePoll);
  return server;
}
