import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { decodeDeckList } from "../src/ankiweb/decks.js";

const LENGTH_DELIMITED = 2;

/** A varint small enough to fit one byte, which every value below is. */
function varint(field: number, value: number): number[] {
  return [field << 3, value];
}

function bytes(field: number, value: readonly number[]): number[] {
  return [(field << 3) | LENGTH_DELIMITED, value.length, ...value];
}

function text(field: number, value: string): number[] {
  return bytes(field, [...new TextEncoder().encode(value)]);
}

interface Node {
  readonly id: number;
  readonly name: string;
  readonly level: number;
  readonly children?: readonly (readonly number[])[];
}

/** A `DeckNode`, whose card count is twice its id so each one differs. */
function node({ id, name, level, children = [] }: Node): number[] {
  return [
    ...varint(1, id),
    ...text(2, name),
    ...children.flatMap((child) => bytes(3, child)),
    ...varint(4, level),
    ...varint(13, id * 2),
  ];
}

describe("decodeDeckList", () => {
  it("reads the recorded list of an account with only the default deck", async () => {
    expect.assertions(1);
    const body = await readFile(
      new URL("fixtures/ankiweb/deck-list-info-default-only.bin", import.meta.url),
    );
    expect(decodeDeckList(body)).toStrictEqual({
      decks: [
        {
          id: 1,
          name: "Default",
          level: 1,
          filtered: false,
          newCount: 0,
          learnCount: 0,
          reviewCount: 0,
          cards: 0,
          cardsIncludingSubdecks: 0,
        },
      ],
      currentDeckId: 1,
      collectionSizeBytes: 139_264,
      mediaSizeBytes: 0,
    });
  });

  it("lists subdecks after their parents under their full names", () => {
    expect.assertions(2);
    const japanese = node({
      id: 10,
      name: "Japanese",
      level: 1,
      children: [
        node({ id: 11, name: "Kana", level: 2 }),
        node({ id: 12, name: "Japanese::Kanji", level: 2 }),
      ],
    });
    const spanish = node({ id: 20, name: "Spanish", level: 1 });
    const root = node({ id: 0, name: "", level: 0, children: [japanese, spanish] });
    const list = decodeDeckList(Uint8Array.from(bytes(1, root)));
    expect(list.decks.map(({ name }) => name)).toStrictEqual([
      "Japanese",
      "Japanese::Kana",
      "Japanese::Kanji",
      "Spanish",
    ]);
    expect(list.decks[1]).toMatchObject({ id: 11, level: 2, cards: 22 });
  });

  it("reads an empty body as no decks", () => {
    expect.assertions(1);
    expect(decodeDeckList(new Uint8Array()).decks).toStrictEqual([]);
  });
});
