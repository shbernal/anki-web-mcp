import type { APIRequestContext } from "playwright";

import { AuthRequiredError } from "../browser/auth-required-error.js";
import { AnkiWebHttpError } from "./http-error.js";
import {
  decodeMessage,
  type Message,
  readBool,
  readMessage,
  readMessages,
  readNumber,
  readString,
} from "./protobuf.js";
import { DECK_LIST_URL } from "./urls.js";

const HTTP_FORBIDDEN = 403;
const SEPARATOR = "::";

// Field numbers, as `docs/ankiweb.md` lists them for each message.
const DECK_LIST_INFO = {
  topNode: 1,
  currentDeckId: 2,
  collectionSizeBytes: 3,
  mediaSizeBytes: 4,
} as const;
const DECK_NODE = {
  deckId: 1,
  name: 2,
  children: 3,
  level: 4,
  reviewCount: 6,
  learnCount: 7,
  newCount: 8,
  totalInDeck: 13,
  totalIncludingChildren: 14,
  filtered: 16,
} as const;

export interface MyDeck {
  readonly id: number;
  /** The full name, with subdecks under their parents as `Parent::Child`. */
  readonly name: string;
  /** 1 for a top-level deck. */
  readonly level: number;
  readonly filtered: boolean;
  readonly newCount: number;
  readonly learnCount: number;
  readonly reviewCount: number;
  readonly cards: number;
  readonly cardsIncludingSubdecks: number;
}

export interface MyDeckList {
  readonly decks: readonly MyDeck[];
  readonly currentDeckId: number;
  readonly collectionSizeBytes: number;
  readonly mediaSizeBytes: number;
}

/**
 * Anki's deck tree names each node by its last component. If AnkiWeb ever sends
 * the full name instead, it is kept as is rather than prefixed twice.
 */
function fullName(parent: string, name: string): string {
  return parent === "" || name.startsWith(`${parent}${SEPARATOR}`)
    ? name
    : `${parent}${SEPARATOR}${name}`;
}

function decodeDeck(node: Message, name: string): MyDeck {
  return {
    id: readNumber(node, DECK_NODE.deckId) ?? 0,
    name,
    level: readNumber(node, DECK_NODE.level) ?? 0,
    filtered: readBool(node, DECK_NODE.filtered),
    newCount: readNumber(node, DECK_NODE.newCount) ?? 0,
    learnCount: readNumber(node, DECK_NODE.learnCount) ?? 0,
    reviewCount: readNumber(node, DECK_NODE.reviewCount) ?? 0,
    cards: readNumber(node, DECK_NODE.totalInDeck) ?? 0,
    cardsIncludingSubdecks: readNumber(node, DECK_NODE.totalIncludingChildren) ?? 0,
  };
}

/** The tree in depth-first order, each parent before its subdecks. */
function flatten(root: Message): MyDeck[] {
  const decks: MyDeck[] = [];
  const visit = (node: Message, parent: string): void => {
    for (const child of readMessages(node, DECK_NODE.children)) {
      const name = fullName(parent, readString(child, DECK_NODE.name) ?? "");
      decks.push(decodeDeck(child, name));
      visit(child, name);
    }
  };
  visit(root, "");
  return decks;
}

/** Decodes `DeckListInfoResponse`, whose unnamed root holds the top-level decks. */
export function decodeDeckList(body: Readonly<Uint8Array>): MyDeckList {
  const response = decodeMessage(body);
  const root = readMessage(response, DECK_LIST_INFO.topNode);
  return {
    decks: root === undefined ? [] : flatten(root),
    currentDeckId: readNumber(response, DECK_LIST_INFO.currentDeckId) ?? 0,
    collectionSizeBytes: readNumber(response, DECK_LIST_INFO.collectionSizeBytes) ?? 0,
    mediaSizeBytes: readNumber(response, DECK_LIST_INFO.mediaSizeBytes) ?? 0,
  };
}

/** The signed-in user's synced decks, through the browser context's cookie jar. */
export async function listMyDecks(request: APIRequestContext): Promise<MyDeckList> {
  const response = await request.post(DECK_LIST_URL, {
    headers: { "content-type": "application/octet-stream" },
    data: Buffer.alloc(0),
  });
  if (response.status() === HTTP_FORBIDDEN) {
    throw new AuthRequiredError();
  }
  if (!response.ok()) {
    throw new AnkiWebHttpError(response.status(), await response.text());
  }
  return decodeDeckList(await response.body());
}
