import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { listMySharedItems } from "../ankiweb/my-shared.js";
import { sharedDeckPageUrl } from "../ankiweb/urls.js";
import type { Accounts } from "../browser/accounts.js";
import { guarded } from "../errors.js";
import { accountInput } from "./account.js";

const item = z.object({
  id: z.number().int().describe("The shared id, as in the listing's URL."),
  title: z.string(),
  url: z.string(),
  thumbsUp: z.number().int(),
  thumbsDown: z.number().int(),
  downloads: z.number().int(),
  modified: z.iso.datetime().describe("Midnight UTC of the day it was last shared."),
});

export function registerMyShared(server: McpServer, accounts: Accounts): void {
  server.registerTool(
    "list_my_shared_decks",
    {
      title: "List my shared decks",
      description:
        "List the decks the signed-in user has shared on AnkiWeb, with downloads and ratings. Needs an AnkiWeb session.",
      inputSchema: z.object({ account: accountInput }),
      outputSchema: z.object({ items: z.array(item) }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guarded("list_my_shared_decks", async ({ account }) => {
      const session = await accounts.session(account);
      const found = await session.useAuthenticated((context) => listMySharedItems(context.request));
      const items = found.map(({ id, title, thumbsUp, thumbsDown, downloads, modified }) => ({
        id,
        title,
        url: sharedDeckPageUrl(id),
        thumbsUp,
        thumbsDown,
        downloads,
        modified,
      }));
      const lines = found.map(
        ({ id, title, downloads, thumbsUp, thumbsDown }) =>
          `${id}  ${title}  (${downloads} downloads, +${thumbsUp}/-${thumbsDown})`,
      );
      const count =
        items.length === 0
          ? "No shared decks on AnkiWeb."
          : `${items.length} shared ${items.length === 1 ? "deck" : "decks"} on AnkiWeb.`;
      return {
        content: [{ type: "text", text: [count, ...lines].join("\n") }],
        structuredContent: { items },
      };
    }),
  );
}
