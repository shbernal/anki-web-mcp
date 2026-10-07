import type { APIRequestContext } from "playwright";

import { decodeMessage, type Message, readMessages, readNumber, readString } from "./protobuf.js";
import { postService } from "./service.js";
import { isoFromSeconds } from "./shared.js";
import { SHARED_LIST_MINE_URL } from "./urls.js";

// Field numbers, as `docs/ankiweb.md` lists them for each message.
const LIST_MINE = {
  items: 1,
} as const;
const ITEM = {
  id: 1,
  title: 2,
  thumbsUp: 3,
  thumbsDown: 4,
  mtime: 5,
  downloads: 6,
} as const;

/** One of the signed-in user's shared listings. It names no deck: AnkiWeb sends none. */
export interface MySharedItem {
  /** The shared id, as in `/shared/info/<id>`. */
  readonly id: number;
  readonly title: string;
  readonly thumbsUp: number;
  readonly thumbsDown: number;
  readonly downloads: number;
  /** Midnight UTC of the day it was last shared, which is all AnkiWeb gives. */
  readonly modified: string;
}

function decodeItem(item: Message): MySharedItem {
  return {
    id: readNumber(item, ITEM.id) ?? 0,
    title: readString(item, ITEM.title) ?? "",
    thumbsUp: readNumber(item, ITEM.thumbsUp) ?? 0,
    thumbsDown: readNumber(item, ITEM.thumbsDown) ?? 0,
    downloads: readNumber(item, ITEM.downloads) ?? 0,
    modified: isoFromSeconds(readNumber(item, ITEM.mtime)),
  };
}

/**
 * Decodes `ListMineResponse`, newest share first. Its `reviews` and
 * `expired_decks` have never been seen set, and are left out.
 */
export function decodeMySharedItems(body: Readonly<Uint8Array>): readonly MySharedItem[] {
  return readMessages(decodeMessage(body), LIST_MINE.items).map((item) => decodeItem(item));
}

/** The signed-in user's shared listings, through the browser context's cookie jar. */
export async function listMySharedItems(
  request: APIRequestContext,
): Promise<readonly MySharedItem[]> {
  return decodeMySharedItems(await postService(request, SHARED_LIST_MINE_URL));
}
