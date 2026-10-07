import type { MyDeck } from "../ankiweb/decks.js";
import { ToolError } from "../errors.js";
import { chooseOne } from "./choose.js";

/** Anki's own deck, which it never removes; AnkiWeb will not share it either. */
export const DEFAULT_DECK_ID = 1;

/**
 * Picks the one deck `input` names by id or exact full name, and refuses to
 * guess between several. The Default deck is refused with `defaultRefusal`,
 * which each tool words for what it would have done.
 */
export function resolveDeck(
  decks: readonly MyDeck[],
  input: string,
  defaultRefusal: string,
): MyDeck {
  const wanted = input.trim();
  const only = chooseOne(decks, wanted, {
    matches: ({ id, name }) => String(id) === wanted || name === wanted,
    what: "deck on AnkiWeb",
    listed: "Decks",
    plural: "decks",
    describe: ({ id, name }) => `${id} (${name})`,
  });
  if (only.id === DEFAULT_DECK_ID) {
    throw new ToolError(defaultRefusal);
  }
  return only;
}
