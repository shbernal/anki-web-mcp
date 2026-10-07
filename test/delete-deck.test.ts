import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decodeMessage, encodeMessage, readNumber } from "../src/ankiweb/protobuf.js";
import { SharedDecks } from "../src/ankiweb/shared.js";
import { type DataDir, resolveDataDir } from "../src/data-dir.js";
import { connectedClient, textOf } from "./connect.js";
import type { FakeReply } from "./fake-context.js";

const PARENT_ID = 1_791_356_255_519;
const CHILD_ID = 1_791_356_257_056;
const FILTERED_ID = 30;
const CHILD_LISTING = 1_606_750_520;

interface Deck {
  readonly id: number;
  readonly name: string;
  readonly cards?: number;
  readonly filtered?: boolean;
  readonly children?: readonly Deck[];
}

/** Default, a parent with one subdeck, a filtered deck, and two decks sharing a name. */
const DECKS: readonly Deck[] = [
  { id: 1, name: "Default" },
  {
    id: PARENT_ID,
    name: "Parent",
    cards: 7,
    children: [{ id: CHILD_ID, name: "Child", cards: 4 }],
  },
  { id: FILTERED_ID, name: "Due today", cards: 3, filtered: true },
  { id: 40, name: "Twin" },
  { id: 41, name: "Twin" },
];

function node({ id, name, cards = 0, filtered = false, children = [] }: Deck): Uint8Array {
  return encodeMessage([
    [1, BigInt(id)],
    [2, name],
    ...children.map((child): [number, Uint8Array] => [3, node(child)]),
    [14, cards],
    [16, filtered || undefined],
  ]);
}

function deckList(decks: readonly Deck[]): Uint8Array {
  return encodeMessage([
    [1, encodeMessage(decks.map((deck): [number, Uint8Array] => [3, node(deck)]))],
  ]);
}

/** `deck-share-info` for the subdeck, which carries a listing. */
const CHILD_SHARE_INFO = encodeMessage([
  [
    1,
    encodeMessage([
      [5, BigInt(CHILD_ID)],
      [6, CHILD_LISTING],
    ]),
  ],
]);

interface Posted {
  readonly path: string;
  readonly body: Uint8Array;
}

function deckIdOf(body: Uint8Array): number | undefined {
  return readNumber(decodeMessage(body), 1);
}

/**
 * Answers the deck list with what is left, and takes a deck off it on
 * `remove-deck` unless `sticky`. `remove-deck` answers an empty `200` either
 * way, as AnkiWeb does.
 */
function ankiWeb(sticky: boolean): {
  readonly posted: Posted[];
  readonly respond: (url: string, body: Uint8Array) => Promise<FakeReply>;
} {
  const posted: Posted[] = [];
  let decks = [...DECKS];
  const respond = async (url: string, body: Uint8Array): Promise<FakeReply> => {
    const path = new URL(url).pathname;
    posted.push({ path, body });
    if (path.endsWith("/deck-list-info")) {
      return { status: 200, body: deckList(decks) };
    }
    if (path.endsWith("/deck-share-info")) {
      return {
        status: 200,
        body: deckIdOf(body) === CHILD_ID ? CHILD_SHARE_INFO : new Uint8Array(),
      };
    }
    if (path.endsWith("/remove-deck") && !sticky) {
      const id = deckIdOf(body);
      decks = decks.filter((deck) => deck.id !== id);
    }
    return { status: 200, body: new Uint8Array() };
  };
  return { posted, respond };
}

let scratch: string;
let dataDir: DataDir;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-"));
  dataDir = resolveDataDir(join(scratch, "data"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function deleteClient(sticky = false): Promise<{
  readonly client: Awaited<ReturnType<typeof connectedClient>>;
  readonly posted: Posted[];
}> {
  const { posted, respond } = ankiWeb(sticky);
  const client = await connectedClient({
    dataDir,
    sharedDecks: new SharedDecks(),
    loggedIn: true,
    respond,
  });
  return { client, posted };
}

function paths(posted: readonly Posted[]): string[] {
  return posted.map(({ path }) => path);
}

function removedIds(posted: readonly Posted[]): (number | undefined)[] {
  return posted
    .filter(({ path }) => path.endsWith("/remove-deck"))
    .map(({ body }) => deckIdOf(body));
}

function deleteDeck(
  deck: string,
  confirm = false,
): {
  name: string;
  arguments: Record<string, unknown>;
} {
  return { name: "delete_deck", arguments: { deck, confirm } };
}

describe("delete_deck", () => {
  it("previews the deck, its subdecks and its cards, posting only reads", async () => {
    expect.assertions(3);
    const { client, posted } = await deleteClient();
    const result = await client.callTool(deleteDeck("Parent"));
    expect(result.structuredContent).toStrictEqual({
      status: "preview",
      deck: { id: PARENT_ID, name: "Parent", filtered: false, cardsIncludingSubdecks: 7 },
      subdecks: [{ id: CHILD_ID, name: "Parent::Child" }],
      listings: [
        {
          deck: { id: CHILD_ID, name: "Parent::Child" },
          sharedId: CHILD_LISTING,
          url: `https://ankiweb.net/shared/info/${CHILD_LISTING}`,
        },
      ],
    });
    expect(textOf(result.content)).toContain(
      [
        "Preview only: nothing was deleted.",
        "7 cards, subdecks included, are deleted with it.",
        "The deletion reaches every device the user syncs on their next sync, and cannot be undone.",
        `Show this to the user, and call again with deck: "${PARENT_ID}", confirm: true only once they agree.`,
        `Deck: Parent (${PARENT_ID})`,
        `Subdecks: Parent::Child (${CHILD_ID})`,
        `Shared listing of Parent::Child: https://ankiweb.net/shared/info/${CHILD_LISTING}. It stays on AnkiWeb after the deck goes; unshare_deck with listing "${CHILD_LISTING}" removes it.`,
      ].join("\n"),
    );
    expect(paths(posted)).toStrictEqual([
      "/svc/decks/deck-list-info",
      "/svc/decks/deck-share-info",
      "/svc/decks/deck-share-info",
    ]);
    await client.close();
  });

  it("says a filtered deck's cards go back to their home decks", async () => {
    expect.assertions(1);
    const { client } = await deleteClient();
    const result = await client.callTool(deleteDeck("Due today"));
    expect(textOf(result.content)).toContain(
      "It is a filtered deck: its 3 cards go back to their home decks rather than being deleted.",
    );
    await client.close();
  });

  it("deletes on confirm by id, and checks the deck is gone", async () => {
    expect.assertions(4);
    const { client, posted } = await deleteClient();
    const result = await client.callTool(deleteDeck(String(PARENT_ID), true));
    expect(result.structuredContent).toMatchObject({ status: "deleted", deck: { id: PARENT_ID } });
    expect(removedIds(posted)).toStrictEqual([PARENT_ID]);
    expect(paths(posted).at(-1)).toBe("/svc/decks/deck-list-info");
    expect(textOf(result.content)).toMatch(
      /^Deleted "Parent"\.\n7 cards, subdecks included, were deleted with it\.\n[^]*It is still on AnkiWeb; unshare_deck/u,
    );
    await client.close();
  });

  it("refuses a confirmed call that names the deck, and posts nothing", async () => {
    expect.assertions(3);
    const { client, posted } = await deleteClient();
    const result = await client.callTool(deleteDeck("Parent", true));
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/names the deck by its id/u);
    expect(posted).toStrictEqual([]);
    await client.close();
  });

  it.each([false, true])("refuses the Default deck, confirm %s", async (confirm) => {
    expect.assertions(3);
    const { client, posted } = await deleteClient();
    const result = await client.callTool(deleteDeck("1", confirm));
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/Anki keeps the Default deck/u);
    expect(removedIds(posted)).toStrictEqual([]);
    await client.close();
  });

  it("refuses an ambiguous name and lists the candidates", async () => {
    expect.assertions(2);
    const { client } = await deleteClient();
    const result = await client.callTool(deleteDeck("Twin"));
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toContain('"Twin" matches 2 decks: 40 (Twin), 41 (Twin)');
    await client.close();
  });

  it("reports a deck AnkiWeb still lists after deleting it", async () => {
    expect.assertions(2);
    const { client } = await deleteClient(true);
    const result = await client.callTool(deleteDeck(String(PARENT_ID), true));
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/accepted the deletion .* but still lists the deck/u);
    await client.close();
  });
});
