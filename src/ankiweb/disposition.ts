const FILENAME_EXTENDED = /filename\*\s*=\s*(?:UTF-8|utf-8)''(?<name>[^;]+)/u;
const FILENAME_PLAIN = /filename\s*=\s*(?:"(?<quoted>[^"]*)"|(?<bare>[^;]+))/u;

/** The `filename` of a `content-disposition` header, preferring the RFC 5987 form. */
export function dispositionFilename(header: string | null): string | undefined {
  const extended = FILENAME_EXTENDED.exec(header ?? "")?.groups?.name;
  if (extended !== undefined) {
    try {
      return decodeURIComponent(extended.trim());
    } catch {
      // A malformed escape falls through to the plain form.
    }
  }
  const plain = FILENAME_PLAIN.exec(header ?? "")?.groups;
  return (plain?.quoted ?? plain?.bare)?.trim();
}
