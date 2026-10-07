import type { McpServer } from "@modelcontextprotocol/server";
import type { APIRequestContext } from "playwright";
import { z } from "zod";

import { listMyDecks, type MyDeck } from "../ankiweb/decks.js";
import {
  fetchShareInfo,
  fetchShareState,
  type PollOptions,
  SHARE_LIMITS,
  type ShareMetadata,
  shareProblems,
  submitShare,
  waitForShare,
} from "../ankiweb/share.js";
import { sharedDeckPageUrl } from "../ankiweb/urls.js";
import type { Accounts } from "../browser/accounts.js";
import { guarded, ToolError } from "../errors.js";
import { accountInput } from "./account.js";

export type { PollOptions } from "../ankiweb/share.js";

const DEFAULT_DECK_ID = 1;
/** Two minutes: AnkiWeb processes a share in the background. */
const DEFAULT_POLL: PollOptions = { intervalMs: 5000, timeoutMs: 120_000 };

const COPYRIGHT_DECLARATION =
  "I declare that the material I am sharing is entirely my own work, or I have obtained a license from the intellectual property holder(s) to share it here.";

const DESCRIPTION = [
  "Publish one of the signed-in user's decks to AnkiWeb's public shared-deck catalogue, under their account. Anyone can then find and download it.",
  "Without `confirm`, nothing is published: the call checks the deck and the listing against AnkiWeb's limits and returns a preview. Show that preview to the user and get their explicit go-ahead before calling again with `confirm: true`.",
  `Calling with \`confirm: true\` publishes the deck and makes AnkiWeb's declaration on the user's behalf: "${COPYRIGHT_DECLARATION}"`,
  "With more than one AnkiWeb account stored, the preview names the one it publishes from, and the confirmed call must name it in `account`.",
  "A deck that is already shared is refused. Needs an AnkiWeb session.",
].join("\n\n");

const tag = z.string().regex(/^\S+$/u, "A tag cannot contain whitespace.");

const inputSchema = z.object({
  deck: z.string().describe("The deck's id or its exact full name, as list_my_decks gives them."),
  title: z
    .string()
    .optional()
    .describe(
      `The listing's title, up to ${SHARE_LIMITS.title} characters. Required unless AnkiWeb has one from an earlier share.`,
    ),
  description: z
    .string()
    .optional()
    .describe(
      `Markdown, up to ${SHARE_LIMITS.description} characters. Required unless AnkiWeb has one from an earlier share.`,
    ),
  tags: z
    .array(tag)
    .readonly()
    .optional()
    .describe(`Up to ${SHARE_LIMITS.tags} characters in all, joined by spaces.`),
  supportUrl: z
    .string()
    .optional()
    .describe(
      `A page where users can ask about the deck, up to ${SHARE_LIMITS.supportUrl} characters.`,
    ),
  account: accountInput,
  confirm: z
    .boolean()
    .default(false)
    .describe("true publishes. Only after the user has seen the preview and agreed."),
});
type ShareInput = Readonly<z.infer<typeof inputSchema>>;

const outputSchema = z.object({
  status: z
    .enum(["preview", "shared", "pending"])
    .describe("`pending` means AnkiWeb accepted the share and is still processing it."),
  account: z
    .string()
    .optional()
    .describe("The account it publishes from, given when more than one is stored."),
  deck: z.object({ id: z.number().int(), name: z.string() }).readonly(),
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()).readonly(),
  supportUrl: z.string(),
  sharesInLast7Days: z.number().int(),
  sharesPerWeek: z.number().int(),
  problems: z
    .array(z.string())
    .readonly()
    .describe("Each one blocks publishing until it is fixed."),
  sharedId: z.number().int().optional(),
  url: z.url().optional(),
});
type ShareOutput = Readonly<z.infer<typeof outputSchema>>;

/** Picks the one deck `input` names by id or exact name, and refuses to guess between several. */
export function resolveDeck(decks: readonly MyDeck[], input: string): MyDeck {
  const wanted = input.trim();
  const matches = decks.filter(({ id, name }) => String(id) === wanted || name === wanted);
  const [only] = matches;
  if (only === undefined) {
    throw new ToolError(
      `No deck on AnkiWeb has the id or name "${wanted}". Decks: ${decks.map(({ id, name }) => `${id} (${name})`).join(", ") || "none"}.`,
    );
  }
  if (matches.length > 1) {
    throw new ToolError(
      `"${wanted}" matches ${matches.length} decks: ${matches.map(({ id, name }) => `${id} (${name})`).join(", ")}. Name one by its id.`,
    );
  }
  if (only.id === DEFAULT_DECK_ID) {
    throw new ToolError(
      "AnkiWeb does not share the Default deck. Move its cards into a new deck and share that.",
    );
  }
  return only;
}

/** The input's fields over what AnkiWeb pre-fills the form with. */
function fillForm(input: ShareInput, prefill: ShareMetadata): ShareMetadata {
  return {
    title: (input.title ?? prefill.title).trim(),
    tags: input.tags?.join(" ") ?? prefill.tags,
    supportUrl: (input.supportUrl ?? prefill.supportUrl).trim(),
    description: input.description ?? prefill.description,
  };
}

function splitTags(tags: string): string[] {
  return tags.split(/\s+/u).filter((one) => one !== "");
}

/**
 * Reads the deck list and share form afresh on every call, so a confirmed
 * share never acts on what an earlier preview saw.
 */
async function prepare(request: APIRequestContext, input: ShareInput): Promise<ShareOutput> {
  const { decks } = await listMyDecks(request);
  const deck = resolveDeck(decks, input.deck);
  const info = await fetchShareInfo(request, deck.id);
  if (info.sharedId !== undefined) {
    throw new ToolError(
      `"${deck.name}" is already shared as ${sharedDeckPageUrl(info.sharedId)}. Updating or removing a listing is done on AnkiWeb.`,
    );
  }
  const metadata = fillForm(input, info.metadata);
  return {
    status: "preview",
    deck: { id: deck.id, name: deck.name },
    ...metadata,
    tags: splitTags(metadata.tags),
    sharesInLast7Days: info.shareCount,
    sharesPerWeek: SHARE_LIMITS.sharesPerWeek,
    problems: shareProblems(metadata, info.shareCount),
  };
}

async function publish(
  request: APIRequestContext,
  preview: ShareOutput,
  poll: PollOptions,
): Promise<ShareOutput> {
  if (preview.problems.length > 0) {
    throw new ToolError(`Nothing was published. ${preview.problems.join(" ")}`);
  }
  const { title, description, supportUrl } = preview;
  const before = await fetchShareState(request);
  await submitShare(request, preview.deck.id, {
    title,
    description,
    supportUrl,
    tags: preview.tags.join(" "),
  });
  const result = await waitForShare(request, before, poll);
  if (result.state === "success" && result.sharedId !== undefined) {
    return {
      ...preview,
      status: "shared",
      sharedId: result.sharedId,
      url: sharedDeckPageUrl(result.sharedId),
    };
  }
  if (result.state === "too_large") {
    throw new ToolError(`AnkiWeb refused "${preview.deck.name}": the deck is too large to share.`);
  }
  if (result.state === "error" || result.state === "success") {
    throw new ToolError(
      `AnkiWeb could not share "${preview.deck.name}" (share state ${result.state}).`,
    );
  }
  return { ...preview, status: "pending" };
}

function summary(output: ShareOutput): string {
  const listing = [
    ...(output.account === undefined ? [] : [`Account: ${output.account}`]),
    `Deck: ${output.deck.name} (${output.deck.id})`,
    `Title: ${output.title}`,
    `Tags: ${output.tags.join(" ") || "(none)"}`,
    `Support page: ${output.supportUrl || "(none)"}`,
    `Description:\n${output.description}`,
  ];
  if (output.status === "shared") {
    return [
      `Shared as ${output.url}. AnkiWeb keeps a new listing hidden from the public for 24 hours, so copyright holders can check it first; until then only its owner, signed in, can open it.`,
      ...listing,
    ].join("\n");
  }
  if (output.status === "pending") {
    return [
      "AnkiWeb accepted the share and is still processing it. It shows on https://ankiweb.net/decks/share/pending, and under the user's shared items once done. Do not share it again.",
      ...listing,
    ].join("\n");
  }
  const verdict =
    output.problems.length === 0
      ? `Ready to publish. Show this to the user, and call again with confirm: true${output.account === undefined ? "" : ` and account: "${output.account}"`} only once they agree.`
      : `Cannot be published yet:\n${output.problems.map((problem) => `- ${problem}`).join("\n")}`;
  return [
    "Preview only: nothing was published.",
    verdict,
    `Shares in the last 7 days: ${output.sharesInLast7Days}/${output.sharesPerWeek}`,
    ...listing,
  ].join("\n");
}

export function registerShare(
  server: McpServer,
  accounts: Accounts,
  poll: PollOptions = DEFAULT_POLL,
): void {
  server.registerTool(
    "share_deck",
    {
      title: "Share a deck publicly",
      description: DESCRIPTION,
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guarded("share_deck", async (input) => {
      const stored = await accounts.list();
      const several = stored.length > 1;
      // A default the user never saw named is no ground to publish from.
      if (input.confirm && several && input.account === undefined) {
        throw new ToolError(
          `Nothing was published. Several AnkiWeb accounts are stored (${stored.join(", ")}): name the one the preview showed in \`account\`.`,
        );
      }
      const session = await accounts.session(input.account);
      const shared = await session.useAuthenticated(async ({ request }) => {
        const preview = await prepare(request, input);
        return input.confirm ? publish(request, preview, poll) : preview;
      });
      const output = several ? { ...shared, account: session.account.name } : shared;
      return {
        content: [{ type: "text", text: summary(output) }],
        structuredContent: output,
      };
    }),
  );
}
