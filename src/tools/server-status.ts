import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { Accounts } from "../browser/accounts.js";
import { hasSessionCookie, readStoredSession } from "../browser/cookies.js";
import { checkDataDir } from "../data-dir.js";
import { guarded } from "../errors.js";
import { version } from "../version.js";
import { accountInput } from "./account.js";

const ACCOUNT_STATUS = z.object({
  name: z.string(),
  sessionStored: z.boolean(),
  lastValidated: z.iso.datetime().optional(),
  authenticated: z.boolean().optional(),
});

const STATUS = z.object({
  version: z.string(),
  dataDir: z.string().describe("Where the sessions are kept."),
  downloadsDir: z.string().describe("Where downloads go when no directory is given."),
  accounts: z
    .array(ACCOUNT_STATUS)
    .describe("Each AnkiWeb account stored, `default` first; just `default` for most users."),
});
type AccountStatus = z.infer<typeof ACCOUNT_STATUS>;

/** What is stored for `name`, asking AnkiWeb about it too when `validate` is set. */
async function accountStatus(
  accounts: Accounts,
  name: string,
  validate: boolean,
): Promise<AccountStatus> {
  const session = await accounts.session(name);
  const { account } = session;
  const stored = (await checkDataDir(account.dir))
    ? await readStoredSession(account.cookies)
    : undefined;
  const authenticated = validate ? await session.checkSignedIn() : undefined;
  // A validation that just succeeded rewrote the file, so read it again.
  const latest = authenticated === true ? await readStoredSession(account.cookies) : stored;
  const lastValidated = latest?.validatedAt;
  return {
    name,
    sessionStored: latest !== undefined && hasSessionCookie(latest.cookies),
    ...(lastValidated === undefined ? {} : { lastValidated }),
    ...(authenticated === undefined ? {} : { authenticated }),
  };
}

export function registerServerStatus(server: McpServer, accounts: Accounts): void {
  server.registerTool(
    "server_status",
    {
      title: "Server status",
      description:
        "Report the server version, where sessions and downloads are kept, and whether an AnkiWeb session is stored for each account. With `validate`, also ask AnkiWeb whether each session, or the one for `account`, is still signed in.",
      inputSchema: z.object({
        account: accountInput,
        validate: z
          .boolean()
          .optional()
          .describe(
            "Check the session against AnkiWeb. Starts a headless browser only when the stored cookie is missing or turned down.",
          ),
      }),
      outputSchema: STATUS,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guarded("server_status", async ({ account, validate }) => {
      // Refuses an unknown name before anything is asked of AnkiWeb.
      const checked = account === undefined ? undefined : await accounts.session(account);
      const stored = await accounts.list();
      // On a fresh install nothing is stored yet, and the account calls would use still shows.
      const names = stored.includes(accounts.fallback) ? stored : [accounts.fallback, ...stored];
      const statuses: AccountStatus[] = [];
      // One at a time, as every request to AnkiWeb is spaced.
      for (const name of names) {
        const validating = validate === true && (checked === undefined || name === account);
        statuses.push(await accountStatus(accounts, name, validating));
      }
      const status = {
        version,
        dataDir: accounts.dataDir.root,
        downloadsDir: accounts.dataDir.downloads,
        accounts: statuses,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(status) }],
        structuredContent: status,
      };
    }),
  );
}

export function registerCloseSession(server: McpServer, accounts: Accounts): void {
  server.registerTool(
    "close_session",
    {
      title: "Close the browser",
      description:
        "Close the server's headless browser to free its memory, once any call in progress has finished: the one for `account`, or without it every one open. The AnkiWeb session stays stored, and the next call that needs the browser starts it again. A browser also closes by itself after five idle minutes.",
      inputSchema: z.object({ account: accountInput }),
      outputSchema: z.object({ closed: z.boolean().describe("false when no browser was open.") }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guarded("close_session", async ({ account }) => {
      const sessions =
        account === undefined ? accounts.opened() : [await accounts.session(account)];
      const released = await Promise.all(sessions.map((session) => session.release()));
      const closed = released.includes(true);
      return {
        content: [{ type: "text", text: closed ? "Browser closed." : "No browser was open." }],
        structuredContent: { closed },
      };
    }),
  );
}
