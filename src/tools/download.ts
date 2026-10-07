import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { AnkiWebHttpError, HTTP_TOO_MANY_REQUESTS } from "../ankiweb/http-error.js";
import { parseSharedId } from "../ankiweb/ids.js";
import type { SharedDeckDownload, SharedDecks } from "../ankiweb/shared.js";
import type { Accounts } from "../browser/accounts.js";
import { AuthRequiredError } from "../browser/auth-required-error.js";
import { guarded, ToolError } from "../errors.js";
import { downloadDirectory, sanitizeFilename, saveApkg } from "../save-apkg.js";
import { accountInput } from "./account.js";

const directory = z
  .string()
  .optional()
  .describe(
    "An absolute path to an existing directory. Defaults to the server's own downloads directory.",
  );

const savedDeck = z.object({ id: z.number().int(), title: z.string() });

const DOWNLOAD_LIMIT =
  "AnkiWeb allows only a few downloads without signing in, and this address has used them.";

/** Whatever can hand over a signed-in session's cookie. */
type CookieSource = Readonly<{ sessionCookie: () => Promise<string> }>;

/** The session's cookie, explaining why one is needed when there is none. */
async function signedInCookie(session: CookieSource): Promise<string> {
  try {
    return await session.sessionCookie();
  } catch (error) {
    throw error instanceof AuthRequiredError
      ? new ToolError(`${DOWNLOAD_LIMIT} ${error.message}`, { cause: error })
      : error;
  }
}

/**
 * Downloads anonymously while AnkiWeb allows it, which needs no browser. Past
 * that, AnkiWeb answers 429 and asks for a login, so the download is retried
 * with the session.
 */
async function startDownload(
  shared: SharedDecks,
  session: CookieSource,
  id: number,
): Promise<SharedDeckDownload> {
  try {
    return await shared.download(id);
  } catch (error) {
    if (!(error instanceof AnkiWebHttpError && error.status === HTTP_TOO_MANY_REQUESTS)) {
      throw error;
    }
  }
  return shared.download(id, await signedInCookie(session));
}

export interface DownloadDependencies {
  readonly shared: SharedDecks;
  readonly accounts: Accounts;
}

export function registerDownload(
  server: McpServer,
  { shared, accounts }: DownloadDependencies,
): void {
  server.registerTool(
    "download_shared_deck",
    {
      title: "Download a shared deck",
      description:
        "Download a shared deck's .apkg from AnkiWeb to disk and return where it was saved. An existing file is never replaced: the new one gets a numbered name. Works without an AnkiWeb session until AnkiWeb asks for one, which it does after a few downloads; then the signed-in session is used. AnkiWeb licenses shared decks for personal use only.",
      inputSchema: z.object({
        deck: z
          .string()
          .describe("The shared deck's id, or its https://ankiweb.net/shared/info/<id> link."),
        directory,
        account: accountInput,
      }),
      outputSchema: z.object({
        path: z.string(),
        filename: z.string(),
        bytes: z.number().int(),
        deck: savedDeck,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    guarded("download_shared_deck", async (input) => {
      const id = parseSharedId(input.deck);
      // Checked first, so a bad path costs no request to AnkiWeb.
      const target = await downloadDirectory(input.directory, accounts.dataDir);
      const session = await accounts.session(input.account);
      const download = await startDownload(shared, session, id);
      const filename = sanitizeFilename(
        download.suggestedFilename ?? download.deck.title,
        String(id),
      );
      const saved = await saveApkg(target, filename, download.body);
      const output = { ...saved, deck: download.deck };
      return {
        content: [
          {
            type: "text",
            text: `Saved "${download.deck.title}" to ${saved.path} (${saved.bytes} bytes).`,
          },
        ],
        structuredContent: output,
      };
    }),
  );
}
