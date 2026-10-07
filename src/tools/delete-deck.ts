import type { McpServer } from "@modelcontextprotocol/server";
import type { APIRequestContext } from "playwright";
import { z } from "zod";

import { listMyDecks, type MyDeck, removeDeck } from "../ankiweb/decks.js";
import { fetchShareInfo } from "../ankiweb/share.js";
import { sharedDeckPageUrl } from "../ankiweb/urls.js";
import type { Accounts } from "../browser/accounts.js";
import { guarded, ToolError } from "../errors.js";
import { accountInput } from "./account.js";
import { resolveDeck } from "./deck-choice.js";

const SEPARATOR = "::";
const DECK_ID = /^\d+$/u;

const DESCRIPTION = [
  "Delete one of the signed-in user's decks, with its subdecks and every card in them, from their AnkiWeb collection. The deletion reaches every device on its next sync and cannot be undone.",
  "Without `confirm`, nothing is deleted: the call finds the deck and returns a preview of what goes. Show that preview to the user and wait for their explicit go-ahead before calling again with `confirm: true`.",
  "The confirmed call must name the deck by its numeric id, as the preview gives it, never by name.",
  "With more than one AnkiWeb account stored, the preview names the one the deck belongs to, and the confirmed call must name it in `account`.",
  "Needs an AnkiWeb session.",
].join("\n\n");

const DEFAULT_DECK_REFUSAL =
  "Anki keeps the Default deck and does not delete it. Delete or move its cards in Anki instead.";

const inputSchema = z.object({
  deck: z
    .string()
    .describe(
      "The deck's id or its exact full name, as list_my_decks gives them. A confirmed call takes the id only.",
    ),
  account: accountInput,
  confirm: z
    .boolean()
    .default(false)
    .describe("true deletes. Only after the user has seen the preview and agreed."),
});

const deckRef = z.object({ id: z.number().int(), name: z.string() }).readonly();

const listing = z.object({ deck: deckRef, sharedId: z.number().int(), url: z.url() }).readonly();

const outputSchema = z.object({
  status: z.enum(["preview", "deleted"]),
  account: z
    .string()
    .optional()
    .describe("The account the deck belongs to, given when more than one is stored."),
  deck: z
    .object({
      id: z.number().int(),
      name: z.string(),
      filtered: z.boolean().describe("A filtered deck's cards go back to their home decks."),
      cardsIncludingSubdecks: z.number().int(),
    })
    .readonly(),
  subdecks: z.array(deckRef).readonly().describe("Deleted along with the deck."),
  listings: z
    .array(listing)
    .readonly()
    .describe(
      "Shared listings of the deck or its subdecks. They stay on AnkiWeb after the deck is deleted; unshare_deck removes them.",
    ),
});
type DeleteOutput = Readonly<z.infer<typeof outputSchema>>;
type Listing = DeleteOutput["listings"][number];

function subdecksOf(decks: readonly MyDeck[], parent: Readonly<MyDeck>): MyDeck[] {
  return decks.filter(({ name }) => name.startsWith(`${parent.name}${SEPARATOR}`));
}

/** The listings shared from any of `decks`, one `deck-share-info` each. */
async function listingsOf(
  request: APIRequestContext,
  decks: readonly MyDeck[],
): Promise<Listing[]> {
  const listings: Listing[] = [];
  // One at a time, as every request to AnkiWeb is spaced.
  for (const { id, name } of decks) {
    const { sharedId } = await fetchShareInfo(request, id);
    if (sharedId !== undefined) {
      listings.push({ deck: { id, name }, sharedId, url: sharedDeckPageUrl(sharedId) });
    }
  }
  return listings;
}

/**
 * Reads the deck list and the decks' listings afresh on every call, so a
 * confirmed deletion never acts on what an earlier preview saw.
 */
async function prepare(request: APIRequestContext, input: string): Promise<DeleteOutput> {
  const { decks } = await listMyDecks(request);
  const deck = resolveDeck(decks, input, DEFAULT_DECK_REFUSAL);
  const subdecks = subdecksOf(decks, deck);
  return {
    status: "preview",
    deck: {
      id: deck.id,
      name: deck.name,
      filtered: deck.filtered,
      cardsIncludingSubdecks: deck.cardsIncludingSubdecks,
    },
    subdecks: subdecks.map(({ id, name }) => ({ id, name })),
    listings: await listingsOf(request, [deck, ...subdecks]),
  };
}

async function remove(request: APIRequestContext, preview: DeleteOutput): Promise<DeleteOutput> {
  await removeDeck(request, preview.deck.id);
  const { decks } = await listMyDecks(request);
  if (decks.some(({ id }) => id === preview.deck.id)) {
    throw new ToolError(
      `AnkiWeb accepted the deletion of "${preview.deck.name}" (${preview.deck.id}) but still lists the deck.`,
    );
  }
  return { ...preview, status: "deleted" };
}

function cardsLine({ status, deck }: DeleteOutput): string {
  const cards = `${deck.cardsIncludingSubdecks} ${deck.cardsIncludingSubdecks === 1 ? "card" : "cards"}`;
  const done = status === "deleted";
  if (deck.filtered) {
    return `It ${done ? "was" : "is"} a filtered deck: its ${cards} ${done ? "went" : "go"} back to their home decks rather than being deleted.`;
  }
  return `${cards}, subdecks included, ${done ? "were" : "are"} deleted with it.`;
}

function details(output: DeleteOutput): string[] {
  const { deck, subdecks, listings } = output;
  return [
    ...(output.account === undefined ? [] : [`Account: ${output.account}`]),
    `Deck: ${deck.name} (${deck.id})`,
    `Subdecks: ${subdecks.map(({ id, name }) => `${name} (${id})`).join(", ") || "(none)"}`,
    ...listings.map(
      ({ deck: shared, sharedId, url }) =>
        `Shared listing of ${shared.name}: ${url}. ${output.status === "deleted" ? "It is still on AnkiWeb" : "It stays on AnkiWeb after the deck goes"}; unshare_deck with listing "${sharedId}" removes it.`,
    ),
  ];
}

function summary(output: DeleteOutput): string {
  if (output.status === "deleted") {
    return [`Deleted "${output.deck.name}".`, cardsLine(output), ...details(output)].join("\n");
  }
  const goAhead = [
    `deck: "${output.deck.id}"`,
    "confirm: true",
    ...(output.account === undefined ? [] : [`account: "${output.account}"`]),
  ].join(", ");
  return [
    "Preview only: nothing was deleted.",
    cardsLine(output),
    "The deletion reaches every device the user syncs on their next sync, and cannot be undone.",
    `Show this to the user, and call again with ${goAhead} only once they agree.`,
    ...details(output),
  ].join("\n");
}

/** What refuses a confirmed call before anything is read: a name, or an unnamed account. */
function refusal(
  input: Readonly<z.infer<typeof inputSchema>>,
  stored: readonly string[],
): string | undefined {
  // A name can mean another deck after a rename between the preview and this
  // call. Reading everything again catches changed contents, not that.
  if (!DECK_ID.test(input.deck.trim())) {
    return `Nothing was deleted. A confirmed deletion names the deck by its id, as the preview gives it, not "${input.deck}".`;
  }
  // A default the user never saw named is no ground to delete from.
  if (stored.length > 1 && input.account === undefined) {
    return `Nothing was deleted. Several AnkiWeb accounts are stored (${stored.join(", ")}): name the one the preview showed in \`account\`.`;
  }
  return undefined;
}

export function registerDeleteDeck(server: McpServer, accounts: Accounts): void {
  server.registerTool(
    "delete_deck",
    {
      title: "Delete a deck",
      description: DESCRIPTION,
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guarded("delete_deck", async (input) => {
      const stored = await accounts.list();
      const refused = input.confirm ? refusal(input, stored) : undefined;
      if (refused !== undefined) {
        throw new ToolError(refused);
      }
      const session = await accounts.session(input.account);
      const result = await session.useAuthenticated(async ({ request }) => {
        const preview = await prepare(request, input.deck);
        return input.confirm ? remove(request, preview) : preview;
      });
      const output = stored.length > 1 ? { ...result, account: session.account.name } : result;
      return {
        content: [{ type: "text", text: summary(output) }],
        structuredContent: output,
      };
    }),
  );
}
