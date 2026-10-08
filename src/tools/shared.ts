import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { parseSharedId } from "../ankiweb/ids.js";
import type { SharedDeckDetail, SharedDeckRow, SharedDecks } from "../ankiweb/shared.js";
import { guarded } from "../errors.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/** A popular deck has hundreds of reviews, which would swamp the rest of the listing. */
const DEFAULT_REVIEWS = 10;

const SORTS = ["rating", "title", "modified"] as const;
type Sort = (typeof SORTS)[number];

const COMPARE: Readonly<Record<Sort, (left: SharedDeckRow, right: SharedDeckRow) => number>> = {
  rating: (left, right) =>
    right.thumbsUp - right.thumbsDown - (left.thumbsUp - left.thumbsDown) ||
    right.thumbsUp - left.thumbsUp,
  title: (left, right) => left.title.localeCompare(right.title),
  modified: (left, right) => right.modified.localeCompare(left.modified),
};

const COUNTS =
  "The notes, audio and images counts are AnkiWeb's own, and audio and images have been seen at 0 for a deck whose sample notes carry both.";

/**
 * A line saying the samples carry media AnkiWeb counts none of, or nothing. The
 * counts are AnkiWeb's and are left as it sent them.
 */
function uncountedMedia({ audio, images, samplesCarry }: Readonly<SharedDeckDetail>): string[] {
  const missed = [
    ...(samplesCarry?.audio === true && audio === 0 ? ["audio"] : []),
    ...(samplesCarry?.images === true && images === 0 ? ["images"] : []),
  ];
  return missed.length === 0
    ? []
    : [
        `AnkiWeb counts no ${missed.join(" or ")} for this deck, but its sample notes carry some, so those counts are wrong.`,
      ];
}

const row = z.object({
  id: z.number().int(),
  title: z.string(),
  url: z.url(),
  thumbsUp: z.number().int(),
  thumbsDown: z.number().int(),
  modified: z.iso.datetime(),
  notes: z.number().int(),
  audio: z.number().int(),
  images: z.number().int(),
});

const sampleField = z.object({ name: z.string(), value: z.string() });
const sampleNote = z.object({ fields: z.array(sampleField), media: z.array(z.url()) });
const review = z.object({
  posted: z.iso.datetime(),
  thumbsUp: z.boolean(),
  text: z.string(),
  reply: z.string().optional(),
});

const detail = z.object({
  id: z.number().int(),
  url: z.url(),
  kind: z.enum(["deck", "addon"]),
  title: z.string(),
  description: z.string().describe("Plain text, with links written as [text](href)."),
  tags: z.array(z.string()),
  sizeBytes: z.number().int(),
  updated: z.iso.datetime(),
  thumbsUp: z.number().int(),
  thumbsDown: z.number().int(),
  tooNewForRating: z.boolean(),
  notes: z.number().int().optional(),
  audio: z.number().int().optional(),
  images: z.number().int().optional(),
  sampleNotes: z.array(sampleNote),
  supportUrl: z.string().optional(),
  originalDeckName: z.string().optional(),
  itemsSharedByAuthor: z.number().int(),
  reviewCount: z.number().int(),
  reviews: z.array(review).describe("The newest reviews, up to the number asked for."),
});

interface SearchPageInput {
  readonly query: string;
  readonly sort: Sort;
  readonly page: number;
  readonly limit: number;
}

function searchPage(
  matches: readonly SharedDeckRow[],
  { query, sort, page, limit }: SearchPageInput,
): { query: string; total: number; page: number; hasMore: boolean; results: SharedDeckRow[] } {
  const start = (page - 1) * limit;
  return {
    query,
    total: matches.length,
    page,
    hasMore: start + limit < matches.length,
    results: matches.toSorted(COMPARE[sort]).slice(start, start + limit),
  };
}

function summaryLine({ id, title, thumbsUp, thumbsDown, notes }: SharedDeckRow): string {
  return `${id}  ${title}  (+${thumbsUp}/-${thumbsDown}, ${notes} notes)`;
}

function registerSearch(server: McpServer, shared: SharedDecks): void {
  server.registerTool(
    "search_shared_decks",
    {
      title: "Search shared decks",
      description: `Search AnkiWeb's shared deck catalogue by title. AnkiWeb returns every match at once, so the results are sorted and paged here. Needs no AnkiWeb session. AnkiWeb rate-limits searches to about four a minute, and a refused address can stay refused for over an hour while get_shared_deck and download_shared_deck keep working; repeating a search within ten minutes is served from cache. ${COUNTS}`,
      inputSchema: z.object({
        query: z.string().trim().min(1).describe("Words to look for in deck titles."),
        sort: z
          .enum(SORTS)
          .default("rating")
          .describe("rating is thumbs up minus thumbs down; modified is newest first."),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
      }),
      outputSchema: z.object({
        query: z.string(),
        total: z.number().int(),
        page: z.number().int(),
        hasMore: z.boolean(),
        results: z.array(row),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guarded("search_shared_decks", async (input) => {
      const output = searchPage(await shared.search(input.query), input);
      const { query, total, page, results } = output;
      const first = (page - 1) * input.limit + 1;
      const heading =
        results.length === 0
          ? `No shared decks on page ${page} for "${query}" (${total} matches).`
          : `${total} shared decks match "${query}"; showing ${first}-${first + results.length - 1}.`;
      return {
        content: [
          {
            type: "text",
            text: [heading, ...results.map((result) => summaryLine(result))].join("\n"),
          },
        ],
        structuredContent: output,
      };
    }),
  );
}

function registerGet(server: McpServer, shared: SharedDecks): void {
  server.registerTool(
    "get_shared_deck",
    {
      title: "Get a shared deck",
      description: `Read a shared deck's AnkiWeb listing: description, tags, size, ratings, sample notes with their media, and reviews. Needs no AnkiWeb session. ${COUNTS}`,
      inputSchema: z.object({
        deck: z
          .string()
          .describe("The shared deck's id, or its https://ankiweb.net/shared/info/<id> link."),
        reviews: z
          .number()
          .int()
          .min(0)
          .default(DEFAULT_REVIEWS)
          .describe("How many of the newest reviews to include."),
      }),
      outputSchema: detail,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guarded("get_shared_deck", async ({ deck, reviews }) => {
      const found = await shared.get(parseSharedId(deck));
      const { downloadKey, samplesCarry, ...full } = found;
      // AnkiWeb lists reviews newest first.
      const listing = {
        ...full,
        reviewCount: full.reviews.length,
        reviews: full.reviews.slice(0, reviews),
      };
      const counts = listing.kind === "deck" ? `, ${listing.notes} notes` : ", an add-on";
      return {
        content: [
          {
            type: "text",
            text: [
              `${listing.title} (${listing.url}${counts}, +${listing.thumbsUp}/-${listing.thumbsDown})`,
              ...uncountedMedia(found),
              "",
              listing.description,
            ].join("\n"),
          },
        ],
        structuredContent: listing,
      };
    }),
  );
}

export function registerSharedDecks(server: McpServer, shared: SharedDecks): void {
  registerSearch(server, shared);
  registerGet(server, shared);
}
