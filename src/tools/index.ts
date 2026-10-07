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
  // The tools that act on AnkiWeb: anything that changes what other people or
  // the user's own devices see there. Downloading and converting only write
  // local files and stay out. Read-only mode registers none of these, so no
  // client lists them, rather than refusing them when called.
  if (!readOnly) {
    registerShare(server, accounts, sharePoll);
  }
  registerCloseSession(server, accounts);
}
