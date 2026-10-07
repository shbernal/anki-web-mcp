import type { McpServer } from "@modelcontextprotocol/server";
import type { APIRequestContext } from "playwright";
import { z } from "zod";

import { InvalidSharedIdError, parseSharedId } from "../ankiweb/ids.js";
import { listMySharedItems, type MySharedItem, removeSharedItem } from "../ankiweb/my-shared.js";
import { sharedDeckPageUrl } from "../ankiweb/urls.js";
import type { Accounts } from "../browser/accounts.js";
import { guarded, ToolError } from "../errors.js";
import { accountInput } from "./account.js";
import { chooseOne } from "./choose.js";

const DESCRIPTION = [
  "Remove one of the signed-in user's listings from AnkiWeb's public shared-deck catalogue, with its ratings and reviews. It cannot be undone. The deck in the user's collection is not touched.",
  "Without `confirm`, nothing is removed: the call finds the listing and returns a preview. Show that preview to the user and get their explicit go-ahead before calling again with `confirm: true`.",
  "With more than one AnkiWeb account stored, the preview names the one the listing belongs to, and the confirmed call must name it in `account`.",
  "Needs an AnkiWeb session.",
].join("\n\n");

const WHAT_REMOVAL_DOES =
  "Removing it takes the listing off AnkiWeb's shared catalogue with its ratings and reviews, and its link then answers as if it never existed. AnkiWeb has no way to restore it. The deck stays in the collection.";

const inputSchema = z.object({
  listing: z
    .string()
    .describe(
      "The listing's shared id, its ankiweb.net/shared/info/<id> link, or its exact title, as list_my_shared_decks gives them.",
    ),
  account: accountInput,
  confirm: z
    .boolean()
    .default(false)
    .describe("true removes. Only after the user has seen the preview and agreed."),
});

const outputSchema = z.object({
  status: z.enum(["preview", "removed"]),
  account: z
    .string()
    .optional()
    .describe("The account the listing belongs to, given when more than one is stored."),
  listing: z
    .object({
      id: z.number().int(),
      title: z.string(),
      url: z.url(),
      downloads: z.number().int(),
      thumbsUp: z.number().int(),
      thumbsDown: z.number().int(),
    })
    .readonly(),
});
type UnshareOutput = Readonly<z.infer<typeof outputSchema>>;

function sharedIdOf(input: string): number | undefined {
  try {
    return parseSharedId(input);
  } catch (error) {
    if (error instanceof InvalidSharedIdError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * The listing `input` names among the user's own. Resolving against `list-mine`
 * is what keeps this tool from ever sending `remove-item` for an id that is
 * not the user's: AnkiWeb answers that request the same either way.
 */
export function resolveListing(items: readonly MySharedItem[], input: string): MySharedItem {
  const wanted = input.trim();
  const id = sharedIdOf(wanted);
  return chooseOne(items, wanted, {
    matches: (item) => item.id === id || item.title === wanted,
    what: "listing of yours on AnkiWeb",
    listed: "Your listings",
    plural: "listings",
    describe: (item) => `${item.id} (${item.title})`,
  });
}

/** Reads the user's listings afresh, so a confirmed removal never acts on what the preview saw. */
async function find(request: APIRequestContext, input: string): Promise<MySharedItem> {
  return resolveListing(await listMySharedItems(request), input);
}

async function remove(request: APIRequestContext, listing: Readonly<MySharedItem>): Promise<void> {
  await removeSharedItem(request, listing.id);
  const after = await listMySharedItems(request);
  if (after.some(({ id }) => id === listing.id)) {
    throw new ToolError(
      `AnkiWeb accepted the removal of "${listing.title}" (${listing.id}) but still lists it. Check ${sharedDeckPageUrl(listing.id)}.`,
    );
  }
}

function outputFor(
  { id, title, downloads, thumbsUp, thumbsDown }: Readonly<MySharedItem>,
  outcome: Pick<UnshareOutput, "status" | "account">,
): UnshareOutput {
  return {
    ...outcome,
    listing: { id, title, url: sharedDeckPageUrl(id), downloads, thumbsUp, thumbsDown },
  };
}

function summary(output: UnshareOutput): string {
  const { listing } = output;
  const details = [
    ...(output.account === undefined ? [] : [`Account: ${output.account}`]),
    `Listing: ${listing.title} (${listing.id})`,
    `Link: ${listing.url}`,
    `Downloads: ${listing.downloads}`,
    `Ratings: +${listing.thumbsUp}/-${listing.thumbsDown}`,
  ];
  if (output.status === "removed") {
    return [
      `Removed "${listing.title}" from the shared catalogue. The deck stays in the collection.`,
      ...details,
    ].join("\n");
  }
  return [
    "Preview only: nothing was removed.",
    WHAT_REMOVAL_DOES,
    `Show this to the user, and call again with confirm: true${output.account === undefined ? "" : ` and account: "${output.account}"`} only once they agree.`,
    ...details,
  ].join("\n");
}

export function registerUnshare(server: McpServer, accounts: Accounts): void {
  server.registerTool(
    "unshare_deck",
    {
      title: "Remove a shared listing",
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
    guarded("unshare_deck", async (input) => {
      const stored = await accounts.list();
      const several = stored.length > 1;
      // A default the user never saw named is no ground to remove from.
      if (input.confirm && several && input.account === undefined) {
        throw new ToolError(
          `Nothing was removed. Several AnkiWeb accounts are stored (${stored.join(", ")}): name the one the preview showed in \`account\`.`,
        );
      }
      const session = await accounts.session(input.account);
      const found = await session.useAuthenticated(async ({ request }) => {
        const listing = await find(request, input.listing);
        if (input.confirm) {
          await remove(request, listing);
        }
        return listing;
      });
      const output = outputFor(found, {
        status: input.confirm ? "removed" : "preview",
        ...(several ? { account: session.account.name } : {}),
      });
      return {
        content: [{ type: "text", text: summary(output) }],
        structuredContent: output,
      };
    }),
  );
}
