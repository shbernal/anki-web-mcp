import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { parseSharedId } from "../ankiweb/ids.js";
import type { SharedDecks } from "../ankiweb/shared.js";
import type { Accounts } from "../browser/accounts.js";
import { guarded } from "../errors.js";
import { downloadDirectory, sanitizeFilename, saveApkg } from "../save-apkg.js";
import { accountInput } from "./account.js";
import { startDownload } from "./start-download.js";

const directory = z
  .string()
  .optional()
  .describe(
    "An absolute path to an existing directory. Defaults to the server's own downloads directory.",
  );

const savedDeck = z.object({ id: z.number().int(), title: z.string() });

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
        "Download a shared deck's .apkg from AnkiWeb to disk and return where it was saved. An existing file is never replaced: the new one gets a numbered name. Works without an AnkiWeb session until AnkiWeb asks for one, which it does after a few downloads; then the signed-in session is used. `via` says which one the download went through. AnkiWeb licenses shared decks for personal use only.",
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
        via: z.enum(["anonymous", "session"]),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    guarded("download_shared_deck", async (input) => {
      const id = parseSharedId(input.deck);
      // Checked first, so a bad path costs no request to AnkiWeb.
      const target = await downloadDirectory(input.directory, accounts.dataDir);
      const session = await accounts.session(input.account);
      const { download, via } = await startDownload(shared, session, id);
      const filename = sanitizeFilename(
        download.suggestedFilename ?? download.deck.title,
        String(id),
      );
      const saved = await saveApkg(target, filename, download.body);
      const output = { ...saved, deck: download.deck, via };
      return {
        content: [
          {
            type: "text",
            text: `Saved "${download.deck.title}" to ${saved.path} (${saved.bytes} bytes${via === "session" ? ", signed in" : ""}).`,
          },
        ],
        structuredContent: output,
      };
    }),
  );
}
