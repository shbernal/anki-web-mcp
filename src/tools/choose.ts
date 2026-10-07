import { ToolError } from "../errors.js";

/** What `chooseOne` looks for, and how its refusals name what it chooses among. */
export interface Choosing<Item> {
  readonly matches: (item: Item) => boolean;
  /** Ends "No … has the id or name": `deck on AnkiWeb`. */
  readonly what: string;
  /** What the refusal lists them as: `Decks`. */
  readonly listed: string;
  /** The plural for an ambiguous match: `decks`. */
  readonly plural: string;
  readonly describe: (item: Item) => string;
}

/**
 * The one item `matches` picks out of `items`. None is refused with every item
 * listed, and several with theirs, never guessed between.
 */
export function chooseOne<Item>(
  items: readonly Item[],
  wanted: string,
  { matches, what, listed, plural, describe }: Choosing<Item>,
): Item {
  const found = items.filter((item) => matches(item));
  const [only] = found;
  if (only === undefined) {
    throw new ToolError(
      `No ${what} has the id or name "${wanted}". ${listed}: ${items.map((item) => describe(item)).join(", ") || "none"}.`,
    );
  }
  if (found.length > 1) {
    throw new ToolError(
      `"${wanted}" matches ${found.length} ${plural}: ${found.map((item) => describe(item)).join(", ")}. Name one by its id.`,
    );
  }
  return only;
}
