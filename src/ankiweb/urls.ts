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

export function sharedSearchUrl(query: string): string {
  return `${ANKIWEB_ORIGIN}/svc/shared/list-decks?${new URLSearchParams({ search: query })}`;
}

export function sharedItemInfoUrl(id: number): string {
  return `${ANKIWEB_ORIGIN}/svc/shared/item-info?${new URLSearchParams({ sharedId: String(id) })}`;
}

/** A file a sample note names as `[sound:0.mp3]` or `[image:1.jpg]`. */
export function sharedSampleMediaUrl(id: number, file: string): string {
  return `${ANKIWEB_ORIGIN}/shared/mpreview/${id}/${encodeURIComponent(file)}`;
}
