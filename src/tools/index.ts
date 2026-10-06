import type { McpServer } from "@modelcontextprotocol/server";

import type { SharedDecks } from "../ankiweb/shared.js";
import type { BrowserSession } from "../browser/session.js";
import type { DataDir } from "../data-dir.js";
import { registerConvert } from "./convert.js";
import { registerDownload } from "./download.js";
import { registerMyDecks } from "./my-decks.js";
import { registerCloseSession, registerServerStatus } from "./server-status.js";
import { type PollOptions, registerShare } from "./share.js";
import { registerSharedDecks } from "./shared.js";

export interface ToolDependencies {
  readonly dataDir: DataDir;
  readonly session: BrowserSession;
  readonly sharedDecks: SharedDecks;
  readonly sharePoll?: PollOptions | undefined;
}

/** Every tool, in the order a client lists them. */
export function registerTools(
  server: McpServer,
  { dataDir, session, sharedDecks, sharePoll }: ToolDependencies,
): void {
  registerServerStatus(server, dataDir, session);
  registerSharedDecks(server, sharedDecks);
  registerDownload(server, { shared: sharedDecks, session, dataDir });
  registerConvert(server);
  registerMyDecks(server, session);
  registerShare(server, session, sharePoll);
  registerCloseSession(server, session);
}
