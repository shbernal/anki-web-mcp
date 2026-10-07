import type { McpServer } from "@modelcontextprotocol/server";

import type { SharedDecks } from "../ankiweb/shared.js";
import type { Accounts } from "../browser/accounts.js";
import { registerConvert } from "./convert.js";
import { registerDownload } from "./download.js";
import { registerMyDecks } from "./my-decks.js";
import { registerCloseSession, registerServerStatus } from "./server-status.js";
import { type PollOptions, registerShare } from "./share.js";
import { registerSharedDecks } from "./shared.js";

export interface ToolDependencies {
  readonly accounts: Accounts;
  readonly sharedDecks: SharedDecks;
  readonly sharePoll?: PollOptions | undefined;
}

/** Every tool, in the order a client lists them. */
export function registerTools(
  server: McpServer,
  { accounts, sharedDecks, sharePoll }: ToolDependencies,
): void {
  registerServerStatus(server, accounts);
  registerSharedDecks(server, sharedDecks);
  registerDownload(server, { shared: sharedDecks, accounts });
  registerConvert(server);
  registerMyDecks(server, accounts);
  registerShare(server, accounts, sharePoll);
  registerCloseSession(server, accounts);
}
