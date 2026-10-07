/**
 * Every AnkiWeb path this server knows. When the site moves something, this is
 * the file to change, alongside `docs/ankiweb.md`.
 */
export const ANKIWEB_ORIGIN = "https://ankiweb.net";
export const LOGIN_URL = `${ANKIWEB_ORIGIN}/account/login`;
export const ACCOUNT_STATUS_URL = `${ANKIWEB_ORIGIN}/svc/account/get-account-status`;

/** The page a person opens for a shared deck, and the path `parseSharedId` reads back. */
export const SHARED_INFO_PATH = "/shared/info/";

export function sharedDeckPageUrl(id: number): string {
  return `${ANKIWEB_ORIGIN}${SHARED_INFO_PATH}${id}`;
}

const SHARED_SEARCH_PATH = "/svc/shared/list-decks";

export function sharedSearchUrl(query: string): string {
  return `${ANKIWEB_ORIGIN}${SHARED_SEARCH_PATH}?${new URLSearchParams({ search: query })}`;
}

export function isSharedSearchUrl(url: string): boolean {
  return URL.parse(url)?.pathname === SHARED_SEARCH_PATH;
}

export function sharedItemInfoUrl(id: number): string {
  return `${ANKIWEB_ORIGIN}/svc/shared/item-info?${new URLSearchParams({ sharedId: String(id) })}`;
}

/** A file a sample note names as `[sound:0.mp3]` or `[image:1.jpg]`. */
export function sharedSampleMediaUrl(id: number, file: string): string {
  return `${ANKIWEB_ORIGIN}/shared/mpreview/${id}/${encodeURIComponent(file)}`;
}

/** The `.apkg` itself. `key` is the listing's `download_key`, minted per request. */
export function sharedDownloadUrl(id: number, key: string): string {
  return `${ANKIWEB_ORIGIN}/svc/shared/download-deck/${id}?${new URLSearchParams([["t", key]])}`;
}

export const DECK_LIST_URL = `${ANKIWEB_ORIGIN}/svc/decks/deck-list-info`;
export const DECK_REMOVE_URL = `${ANKIWEB_ORIGIN}/svc/decks/remove-deck`;
export const DECK_SHARE_INFO_URL = `${ANKIWEB_ORIGIN}/svc/decks/deck-share-info`;
export const DECK_SHARE_URL = `${ANKIWEB_ORIGIN}/svc/decks/deck-share`;
export const DECK_SHARE_STATE_URL = `${ANKIWEB_ORIGIN}/svc/decks/deck-share-state`;

export const SHARED_LIST_MINE_URL = `${ANKIWEB_ORIGIN}/svc/shared/list-mine`;
export const SHARED_REMOVE_ITEM_URL = `${ANKIWEB_ORIGIN}/svc/shared/remove-item`;
