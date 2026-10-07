import { McpServer } from "@modelcontextprotocol/server";

import { SharedDecks } from "./ankiweb/shared.js";
import type { Accounts } from "./browser/accounts.js";
import { registerTools } from "./tools/index.js";
import type { PollOptions } from "./tools/share.js";
import { version } from "./version.js";

export const READ_ONLY_ENV = "ANKI_WEB_MCP_READ_ONLY";

const READ_ONLY_ON = new Set(["1", "true"]);
const READ_ONLY_OFF = new Set(["", "0", "false"]);

/** A value of `ANKI_WEB_MCP_READ_ONLY` that is neither on nor off, reported as usage. */
export interface ReadOnlyUsage {
  readonly usage: string;
}

/**
 * Whether to serve read-only: `--read-only` or `--no-read-only` when one is
 * given, then `ANKI_WEB_MCP_READ_ONLY`, then off.
 */
export function readOnlyMode(
  flag: boolean | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean | ReadOnlyUsage {
  if (flag !== undefined) {
    return flag;
  }
  const value = env[READ_ONLY_ENV]?.toLowerCase();
  if (value === undefined || READ_ONLY_OFF.has(value)) {
    return false;
  }
  if (READ_ONLY_ON.has(value)) {
    return true;
  }
  return { usage: `${READ_ONLY_ENV} takes 1, true, 0 or false` };
}

export interface ServerOptions {
  readonly accounts: Accounts;
  /** Defaults to a live one; it caches what AnkiWeb lets it for the server's lifetime. */
  readonly sharedDecks?: SharedDecks;
  /** How `share_deck` waits on AnkiWeb after submitting. */
  readonly sharePoll?: PollOptions;
  /** Registers no tool that changes anything on AnkiWeb. */
  readonly readOnly?: boolean;
}

export function createServer({
  accounts,
  sharedDecks = new SharedDecks(),
  sharePoll,
  readOnly = false,
}: ServerOptions): McpServer {
  const server = new McpServer({ name: "anki-web-mcp", version });
  registerTools(server, { accounts, sharedDecks, sharePoll, readOnly });
  return server;
}
