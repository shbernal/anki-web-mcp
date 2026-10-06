import { htmlToText } from "./html.js";
import {
  decodeMessage,
  type Message,
  readBool,
  readMessage,
  readMessages,
  readNumber,
  readString,
} from "./protobuf.js";
import { ResponseCache, type ResponseCacheOptions } from "./response-cache.js";
import {
  sharedDeckPageUrl,
  sharedItemInfoUrl,
  sharedSampleMediaUrl,
  sharedSearchUrl,
} from "./urls.js";

const MS_PER_SECOND = 1000;
const SAMPLE_MEDIA = /\[(?:sound|image):(?<file>[^\]]+)\]/gu;

// Field numbers, as `docs/ankiweb.md` lists them for each message.
const LIST_DECKS = { rows: 1 } as const;
const ROW = {
  id: 1,
  title: 2,
  thumbsUp: 3,
  thumbsDown: 4,
  mtime: 5,
  notes: 6,
  audio: 7,
  images: 8,
} as const;
const ITEM_INFO = { available: 1, accessDenied: 3 } as const;
const AVAILABLE = {
  reviews: 1,
  title: 5,
  tags: 6,
  size: 7,
  lastUpdated: 8,
  description: 9,
  deck: 10,
  supportUrl: 12,
  itemsSharedByUser: 13,
  thumbsUp: 18,
  thumbsDown: 19,
  originalDeckName: 20,
  tooNewForRating: 21,
} as const;
const DECK = { notes: 1, audio: 2, images: 3, sampleNotes: 4, downloadKey: 5 } as const;
const SAMPLE_NOTE = { fields: 1 } as const;
const SAMPLE_FIELD = { name: 1, value: 2 } as const;
const REVIEW = { postTimestamp: 1, thumbsUp: 2, body: 4, replyText: 5 } as const;

export interface SharedDeckRow {
  readonly id: number;
  readonly title: string;
  readonly url: string;
  readonly thumbsUp: number;
  readonly thumbsDown: number;
  /** ISO 8601. */
  readonly modified: string;
  readonly notes: number;
  readonly audio: number;
  readonly images: number;
}

export interface SampleNote {
  readonly fields: readonly { readonly name: string; readonly value: string }[];
  /** The audio and images the fields name, as URLs AnkiWeb serves them from. */
  readonly media: readonly string[];
}

export interface SharedDeckReview {
  /** ISO 8601. */
  readonly posted: string;
  readonly thumbsUp: boolean;
  readonly text: string;
  readonly reply?: string;
}

export interface SharedDeckDetail {
  readonly id: number;
  readonly url: string;
  /** AnkiWeb lists add-ons under the same ids; those carry no deck counts or samples. */
  readonly kind: "deck" | "addon";
  readonly title: string;
  /** Plain text, with links written as `[text](href)`. */
  readonly description: string;
  readonly tags: readonly string[];
  readonly sizeBytes: number;
  /** ISO 8601. */
  readonly updated: string;
  readonly thumbsUp: number;
  readonly thumbsDown: number;
  readonly tooNewForRating: boolean;
  readonly notes?: number;
  readonly audio?: number;
  readonly images?: number;
  readonly sampleNotes: readonly SampleNote[];
  readonly supportUrl?: string;
  readonly originalDeckName?: string;
  readonly itemsSharedByAuthor: number;
  readonly reviews: readonly SharedDeckReview[];
  /** What the download URL needs as `t`. Present for decks only. */
  readonly downloadKey?: string;
}

function isoFromSeconds(seconds: number | undefined): string {
  return new Date((seconds ?? 0) * MS_PER_SECOND).toISOString();
}

/** Protobuf leaves an empty string out, so absent and empty read the same. */
function nonEmpty(value: string | undefined): string | undefined {
  return value === "" ? undefined : value;
}

function decodeRow(row: Message): SharedDeckRow {
  const id = readNumber(row, ROW.id) ?? 0;
  return {
    id,
    title: readString(row, ROW.title) ?? "",
    url: sharedDeckPageUrl(id),
    thumbsUp: readNumber(row, ROW.thumbsUp) ?? 0,
    thumbsDown: readNumber(row, ROW.thumbsDown) ?? 0,
    modified: isoFromSeconds(readNumber(row, ROW.mtime)),
    notes: readNumber(row, ROW.notes) ?? 0,
    audio: readNumber(row, ROW.audio) ?? 0,
    images: readNumber(row, ROW.images) ?? 0,
  };
}

/** Decodes `ListDecksResponse`. An empty body, which is what an empty search gets, is no rows. */
export function decodeSearch(body: Readonly<Uint8Array>): SharedDeckRow[] {
  return readMessages(decodeMessage(body), LIST_DECKS.rows).map((row) => decodeRow(row));
}

/** AnkiWeb rewrites a sample's media references to `[sound:0.mp3]` and `[image:1.jpg]`. */
function sampleMedia(id: number, value: string): string[] {
  const urls: string[] = [];
  for (const match of value.matchAll(SAMPLE_MEDIA)) {
    urls.push(sharedSampleMediaUrl(id, match.groups?.file ?? ""));
  }
  return urls;
}

function decodeSampleNote(id: number, note: Message): SampleNote {
  const fields = readMessages(note, SAMPLE_NOTE.fields).map(
    (field): SampleNote["fields"][number] => ({
      name: readString(field, SAMPLE_FIELD.name) ?? "",
      value: readString(field, SAMPLE_FIELD.value) ?? "",
    }),
  );
  return { fields, media: fields.flatMap(({ value }) => sampleMedia(id, value)) };
}

function decodeReview(review: Message): SharedDeckReview {
  const reply = nonEmpty(readString(review, REVIEW.replyText));
  return {
    posted: isoFromSeconds(readNumber(review, REVIEW.postTimestamp)),
    thumbsUp: readBool(review, REVIEW.thumbsUp),
    text: readString(review, REVIEW.body) ?? "",
    ...(reply === undefined ? {} : { reply }),
  };
}

function decodeDeck(id: number, deck: Message): Partial<SharedDeckDetail> {
  const downloadKey = nonEmpty(readString(deck, DECK.downloadKey));
  return {
    notes: readNumber(deck, DECK.notes) ?? 0,
    audio: readNumber(deck, DECK.audio) ?? 0,
    images: readNumber(deck, DECK.images) ?? 0,
    sampleNotes: readMessages(deck, DECK.sampleNotes).map((note) => decodeSampleNote(id, note)),
    ...(downloadKey === undefined ? {} : { downloadKey }),
  };
}

function decodeAvailable(id: number, available: Message): SharedDeckDetail {
  const deck = readMessage(available, AVAILABLE.deck);
  const supportUrl = nonEmpty(readString(available, AVAILABLE.supportUrl));
  const originalDeckName = nonEmpty(readString(available, AVAILABLE.originalDeckName));
  return {
    id,
    url: sharedDeckPageUrl(id),
    kind: deck === undefined ? "addon" : "deck",
    title: readString(available, AVAILABLE.title) ?? "",
    description: htmlToText(readString(available, AVAILABLE.description) ?? ""),
    tags: (readString(available, AVAILABLE.tags) ?? "").split(" ").filter((tag) => tag !== ""),
    sizeBytes: readNumber(available, AVAILABLE.size) ?? 0,
    updated: isoFromSeconds(readNumber(available, AVAILABLE.lastUpdated)),
    thumbsUp: readNumber(available, AVAILABLE.thumbsUp) ?? 0,
    thumbsDown: readNumber(available, AVAILABLE.thumbsDown) ?? 0,
    tooNewForRating: readBool(available, AVAILABLE.tooNewForRating),
    sampleNotes: [],
    ...(deck === undefined ? {} : decodeDeck(id, deck)),
    ...(supportUrl === undefined ? {} : { supportUrl }),
    ...(originalDeckName === undefined ? {} : { originalDeckName }),
    itemsSharedByAuthor: readNumber(available, AVAILABLE.itemsSharedByUser) ?? 0,
    reviews: readMessages(available, AVAILABLE.reviews).map((review) => decodeReview(review)),
  };
}

/** Decodes `ItemInfoResponse`, and throws when AnkiWeb has no listing to show. */
export function decodeItemInfo(id: number, body: Readonly<Uint8Array>): SharedDeckDetail {
  const response = decodeMessage(body);
  const available = readMessage(response, ITEM_INFO.available);
  if (available !== undefined) {
    return decodeAvailable(id, available);
  }
  throw new Error(
    readBool(response, ITEM_INFO.accessDenied)
      ? `AnkiWeb refused access to shared item ${id}`
      : `AnkiWeb has no shared item ${id}`,
  );
}

/**
 * AnkiWeb's shared deck catalogue. Every call here is an anonymous GET, so none
 * of it touches the browser or needs a session.
 */
export class SharedDecks {
  readonly #responses: ResponseCache;

  constructor(options: ResponseCacheOptions = {}) {
    this.#responses = new ResponseCache(options);
  }

  /** Every match in one list: AnkiWeb neither pages nor sorts searches. */
  async search(query: string): Promise<SharedDeckRow[]> {
    return decodeSearch(await this.#responses.get(sharedSearchUrl(query)));
  }

  async get(id: number): Promise<SharedDeckDetail> {
    return decodeItemInfo(id, await this.#responses.get(sharedItemInfoUrl(id)));
  }
}
