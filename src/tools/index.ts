import type { McpServer } from "@modelcontextprotocol/server";

import type { SharedDecks } from "../ankiweb/shared.js";
import type { Accounts } from "../browser/accounts.js";
import { type PollOptions, registerActingTools } from "./acting.js";
import { registerConvert } from "./convert.js";
import { registerDownload } from "./download.js";
import { registerMyDecks } from "./my-decks.js";
import { registerMyShared } from "./my-shared.js";
import { registerCloseSession, registerServerStatus } from "./server-status.js";
import { registerSharedDecks } from "./shared.js";

export interface ToolDependencies {
  readonly accounts: Accounts;
  readonly sharedDecks: SharedDecks;
  readonly sharePoll?: PollOptions | undefined;
  /** Leaves out every tool that acts on AnkiWeb. */
  readonly readOnly?: boolean | undefined;
}

/** Every tool, in the order a client lists them. */
export function registerTools(
  server: McpServer,
  { accounts, sharedDecks, sharePoll, readOnly = false }: ToolDependencies,
): void {
  registerServerStatus(server, accounts, readOnly);
  registerSharedDecks(server, sharedDecks);
  registerDownload(server, { shared: sharedDecks, accounts });
  registerConvert(server);
  registerMyDecks(server, accounts);
  registerMyShared(server, accounts);
  if (!readOnly) {
    registerActingTools(server, accounts, sharePoll);
  }
  registerCloseSession(server, accounts);
}
