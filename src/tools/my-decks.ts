import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { listMyDecks } from "../ankiweb/decks.js";
import type { BrowserSession } from "../browser/session.js";
import { guarded } from "../errors.js";

const deck = z.object({
  id: z.number().int(),
  name: z.string().describe("The full name, with subdecks written as Parent::Child."),
  level: z.number().int().describe("1 for a top-level deck."),
  filtered: z.boolean(),
  newCount: z.number().int(),
  learnCount: z.number().int(),
  reviewCount: z.number().int(),
  cards: z.number().int(),
  cardsIncludingSubdecks: z.number().int(),
});

export function registerMyDecks(server: McpServer, session: BrowserSession): void {
  server.registerTool(
    "list_my_decks",
    {
      title: "List my decks",
      description:
        "List the decks synced to the signed-in AnkiWeb account, parents before their subdecks, with due counts and card totals. Needs an AnkiWeb session.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        decks: z.array(deck),
        currentDeckId: z.number().int(),
        collectionSizeBytes: z.number().int(),
        mediaSizeBytes: z.number().int(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guarded("list_my_decks", async () => {
      const list = await session.useAuthenticated((context) => listMyDecks(context.request));
      const lines = list.decks.map(
        ({ id, name, cardsIncludingSubdecks }) =>
          `${id}  ${name}  (${cardsIncludingSubdecks} cards)`,
      );
      return {
        content: [
          {
            type: "text",
            text: [
              `${list.decks.length} ${list.decks.length === 1 ? "deck" : "decks"} on AnkiWeb.`,
              ...lines,
            ].join("\n"),
          },
        ],
        structuredContent: list,
      };
    }),
  );
}
