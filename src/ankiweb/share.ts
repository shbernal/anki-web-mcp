import { setTimeout as sleep } from "node:timers/promises";

import type { APIRequestContext } from "playwright";

import { decodeMessage, encodeMessage, readMessage, readNumber, readString } from "./protobuf.js";
import { postService } from "./service.js";
import { DECK_SHARE_INFO_URL, DECK_SHARE_STATE_URL, DECK_SHARE_URL } from "./urls.js";

// Field numbers, as `docs/ankiweb.md` lists them for each message.
const SHARE_INFO = { metadata: 1, shareCount: 3 } as const;
const METADATA = {
  title: 1,
  tags: 2,
  supportUrl: 3,
  description: 4,
  deckId: 5,
  sharedId: 6,
} as const;
const SHARE_REQUEST = { metadata: 1, confirmCopyright: 2 } as const;
const SHARE_STATE = { state: 1, sharedId: 2 } as const;
const DECK_ID_REQUEST = { deckId: 1 } as const;

/** The limits the share form enforces, and its weekly quota. */
export const SHARE_LIMITS = {
  title: 60,
  tags: 60,
  supportUrl: 180,
  description: 65_000,
  sharesPerWeek: 20,
} as const;

/** What the share form holds. `tags` is AnkiWeb's own space-separated string. */
export interface ShareMetadata {
  readonly title: string;
  readonly tags: string;
  readonly supportUrl: string;
  readonly description: string;
}

export interface ShareInfo {
  readonly deckId: number;
  /** What the form is pre-filled with: empty for a deck never shared. */
  readonly metadata: ShareMetadata;
  /** Set when the deck was shared before. */
  readonly sharedId?: number;
  /** Shares in the last seven days, against `SHARE_LIMITS.sharesPerWeek`. */
  readonly shareCount: number;
}

/** Decodes `DeckShareInfoResponse`, which pre-fills the share form. */
export function decodeShareInfo(body: Readonly<Uint8Array>, deckId: number): ShareInfo {
  const response = decodeMessage(body);
  const metadata = readMessage(response, SHARE_INFO.metadata) ?? new Map();
  const sharedId = readNumber(metadata, METADATA.sharedId);
  return {
    deckId,
    metadata: {
      title: readString(metadata, METADATA.title) ?? "",
      tags: (readString(metadata, METADATA.tags) ?? "").trim(),
      supportUrl: readString(metadata, METADATA.supportUrl) ?? "",
      description: readString(metadata, METADATA.description) ?? "",
    },
    ...(sharedId === undefined ? {} : { sharedId }),
    shareCount: readNumber(response, SHARE_INFO.shareCount) ?? 0,
  };
}

export async function fetchShareInfo(
  request: APIRequestContext,
  deckId: number,
): Promise<ShareInfo> {
  const body = encodeMessage([[DECK_ID_REQUEST.deckId, BigInt(deckId)]]);
  return decodeShareInfo(await postService(request, DECK_SHARE_INFO_URL, body), deckId);
}

function tooLong(label: string, value: string, limit: number): string[] {
  return value.length > limit
    ? [`${label} is ${value.length} characters; the limit is ${limit}.`]
    : [];
}

/** Everything that would keep the share form's button disabled, or AnkiWeb from accepting it. */
export function shareProblems(metadata: ShareMetadata, shareCount: number): string[] {
  return [
    ...(metadata.title.trim() === "" ? ["A title is required."] : []),
    ...(metadata.description.trim() === "" ? ["A description is required."] : []),
    ...tooLong("The title", metadata.title, SHARE_LIMITS.title),
    ...tooLong("The tags", metadata.tags, SHARE_LIMITS.tags),
    ...tooLong("The support page", metadata.supportUrl, SHARE_LIMITS.supportUrl),
    ...tooLong("The description", metadata.description, SHARE_LIMITS.description),
    ...(shareCount >= SHARE_LIMITS.sharesPerWeek
      ? [
          `This account has shared ${shareCount} decks in the last 7 days, and AnkiWeb allows ${SHARE_LIMITS.sharesPerWeek}.`,
        ]
      : []),
  ];
}

/**
 * Encodes `DeckShareRequest`. `confirm_copyright` is the form's "I declare that
 * the material I am sharing is entirely my own work…" checkbox, and is always
 * set: AnkiWeb refuses a share without it.
 */
export function encodeShareRequest(deckId: number, metadata: ShareMetadata): Uint8Array {
  const fields = encodeMessage([
    [METADATA.title, metadata.title],
    [METADATA.tags, metadata.tags],
    [METADATA.supportUrl, metadata.supportUrl],
    [METADATA.description, metadata.description],
    [METADATA.deckId, BigInt(deckId)],
  ]);
  return encodeMessage([
    [SHARE_REQUEST.metadata, fields],
    [SHARE_REQUEST.confirmCopyright, true],
  ]);
}

export async function submitShare(
  request: APIRequestContext,
  deckId: number,
  metadata: ShareMetadata,
): Promise<void> {
  await postService(request, DECK_SHARE_URL, encodeShareRequest(deckId, metadata));
}

const STATES = ["none", "waiting", "in_progress", "success", "too_large"] as const;
export type ShareStateName = (typeof STATES)[number] | "error";

export interface ShareState {
  readonly state: ShareStateName;
  /** The listing's id, set on success. */
  readonly sharedId?: number;
}

/** Decodes `DeckShareStateResponse`. Any state past `TOO_LARGE` is an error. */
export function decodeShareState(body: Readonly<Uint8Array>): ShareState {
  const response = decodeMessage(body);
  const sharedId = readNumber(response, SHARE_STATE.sharedId);
  return {
    state: STATES[readNumber(response, SHARE_STATE.state) ?? 0] ?? "error",
    ...(sharedId === undefined ? {} : { sharedId }),
  };
}

export async function fetchShareState(request: APIRequestContext): Promise<ShareState> {
  return decodeShareState(await postService(request, DECK_SHARE_STATE_URL));
}

export interface PollOptions {
  /** AnkiWeb's own page polls every five seconds. */
  readonly intervalMs: number;
  readonly timeoutMs: number;
}

const UNSETTLED: ReadonlySet<ShareStateName> = new Set(["none", "waiting", "in_progress"]);

/** Whether `current` is a new outcome rather than one still pending, or the one read before the submit. */
function isNewOutcome(current: ShareState, before: ShareState): boolean {
  return (
    !UNSETTLED.has(current.state) &&
    !(current.state === before.state && current.sharedId === before.sharedId)
  );
}

/**
 * Polls the share state until it settles or `timeoutMs` passes. AnkiWeb keeps
 * answering with the last share's outcome after it finishes, so `before`, read
 * just ahead of the submit, is waited past rather than taken for this share's.
 * Right after a submit, `none` can mean AnkiWeb has not queued the share yet,
 * so it is waited on like `waiting`. On timeout the result is `waiting`.
 */
export async function waitForShare(
  request: APIRequestContext,
  before: ShareState,
  { intervalMs, timeoutMs }: PollOptions,
): Promise<ShareState> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const current = await fetchShareState(request);
    if (isNewOutcome(current, before)) {
      return current;
    }
    if (Date.now() + intervalMs > deadline) {
      return { state: "waiting" };
    }
    await sleep(intervalMs);
  }
}
