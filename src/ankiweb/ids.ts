import { ANKIWEB_ORIGIN, SHARED_INFO_PATH } from "./urls.js";

/** Shared ids are protobuf `uint32`. */
const MAX_SHARED_ID = 0xff_ff_ff_ff;
const DIGITS = /^\d+$/u;
const SHARED_INFO_HOSTS = new Set(["ankiweb.net", "www.ankiweb.net"]);

export class InvalidSharedIdError extends Error {
  override name = "InvalidSharedIdError";

  constructor(input: string) {
    super(`"${input}" is neither a shared deck id nor an ankiweb.net/shared/info/<id> link`);
  }
}

function fromUrl(input: string): string | undefined {
  // A bare `ankiweb.net/shared/...` or `/shared/...` has no scheme, so resolving
  // it against the origin turns all three spellings into one absolute URL.
  const withScheme = input.startsWith("ankiweb.net") ? `https://${input}` : input;
  const url = URL.parse(withScheme, ANKIWEB_ORIGIN);
  if (
    url === null ||
    !SHARED_INFO_HOSTS.has(url.hostname) ||
    !url.pathname.startsWith(SHARED_INFO_PATH)
  ) {
    return undefined;
  }
  return url.pathname.slice(SHARED_INFO_PATH.length).replace(/\/$/u, "");
}

/** Accepts a shared deck's id or the link to its page, and returns the id. */
export function parseSharedId(input: string): number {
  const trimmed = input.trim();
  const digits = DIGITS.test(trimmed) ? trimmed : fromUrl(trimmed);
  const id = digits !== undefined && DIGITS.test(digits) ? Number(digits) : Number.NaN;
  if (!Number.isSafeInteger(id) || id < 1 || id > MAX_SHARED_ID) {
    throw new InvalidSharedIdError(input);
  }
  return id;
}
