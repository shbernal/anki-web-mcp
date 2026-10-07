import type { McpServer } from "@modelcontextprotocol/server";

import type { Accounts } from "../browser/accounts.js";
import { type PollOptions, registerShare } from "./share.js";
import { registerUnshare } from "./unshare.js";

export type { PollOptions } from "./share.js";

/**
 * The tools that act on AnkiWeb: anything that changes what other people or
 * the user's own devices see there. Downloading and converting only write
 * local files and are not among them. Read-only mode registers none of these,
 * so no client lists them, rather than refusing them when called.
 */
export function registerActingTools(
  server: McpServer,
  accounts: Accounts,
  sharePoll: PollOptions | undefined,
): void {
  registerShare(server, accounts, sharePoll);
  registerUnshare(server, accounts);
}
