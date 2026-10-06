const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
const HEX = 16;
const DECIMAL = 10;
const MAX_CODE_POINT = 0x10_ff_ff;

function codePoint(entity: string, value: number): string {
  return value <= MAX_CODE_POINT ? String.fromCodePoint(value) : entity;
}

function decodeEntities(text: string): string {
  return text
    .replaceAll(/&#(?<number>x[\da-f]+|\d+);/giu, (entity, number: string) =>
      codePoint(
        entity,
        number.startsWith("x") || number.startsWith("X")
          ? Number.parseInt(number.slice(1), HEX)
          : Number.parseInt(number, DECIMAL),
      ),
    )
    .replaceAll(
      /&(?<name>[a-z]+);/giu,
      (entity, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? entity,
    );
}

function attribute(tag: string, name: string): string | undefined {
  const groups = new RegExp(
    `\\s${name}\\s*=\\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\\s>]+))`,
    "iu",
  ).exec(tag)?.groups;
  // Entities stay encoded here: the whole text is decoded once, at the end.
  return groups?.double ?? groups?.single ?? groups?.bare;
}

/**
 * Turns a shared deck's HTML description into plain text that keeps its links,
 * written the way Markdown writes them: `[text](href)` and `![alt](src)`.
 * Block elements become line breaks and list items become `- ` lines; every
 * other tag is dropped. AnkiWeb renders descriptions from Markdown, so the
 * HTML is simple, and a lossy pass is enough to read it.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replaceAll(
        /<a\b(?<attributes>[^>]*)>(?<text>[\s\S]*?)<\/a>/giu,
        (whole, attributes: string, text: string) => {
          const href = attribute(attributes, "href");
          return href === undefined ? text : `[${text}](${href})`;
        },
      )
      .replaceAll(/<img\b[^>]*>/giu, (tag) => {
        const src = attribute(tag, "src");
        return src === undefined ? "" : `\n![${attribute(tag, "alt") ?? ""}](${src})\n`;
      })
      .replaceAll(/<br\s*\/?>/giu, "\n")
      .replaceAll(/\s*<li\b[^>]*>/giu, "\n- ")
      .replaceAll(/<\/(?:p|div|h\d|ul|ol|blockquote|pre|table|tr)>/giu, "\n\n")
      .replaceAll(/<[^>]*>/gu, ""),
  )
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim();
}
