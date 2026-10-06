import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { AnkiWebHttpError } from "../src/ankiweb/http-error.js";
import { decodeItemInfo, decodeSearch, SharedDecks } from "../src/ankiweb/shared.js";
import { fakeFetch, fixtureResponse } from "./fake-fetch.js";

async function fixture(name: string): Promise<Buffer> {
  return readFile(new URL(`fixtures/ankiweb/${name}`, import.meta.url));
}

describe("decodeSearch", () => {
  it("reads every row of a search", async () => {
    expect.assertions(2);
    const rows = decodeSearch(await fixture("list-decks-japanese.bin"));
    expect(rows).toHaveLength(1899);
    expect(rows[0]).toStrictEqual({
      id: 911_122_782,
      title: "Japanese course based on Tae Kim's grammar guide & anime",
      url: "https://ankiweb.net/shared/info/911122782",
      thumbsUp: 1559,
      thumbsDown: 29,
      modified: "2023-10-19T18:24:13.000Z",
      notes: 2164,
      audio: 2076,
      images: 2076,
    });
  });

  it("reads the empty body of an empty search as no rows", () => {
    expect.assertions(1);
    expect(decodeSearch(new Uint8Array())).toStrictEqual([]);
  });
});

describe("decodeItemInfo", () => {
  it("reads a deck's listing", async () => {
    expect.assertions(4);
    const deck = decodeItemInfo(2_183_294_427, await fixture("item-info-2183294427.bin"));
    expect(deck).toMatchObject({
      id: 2_183_294_427,
      url: "https://ankiweb.net/shared/info/2183294427",
      kind: "deck",
      title: "Japanese Basic Hiragana",
      tags: ["Japanese", "Hiragana", "audio", "type", "language", "characters"],
      sizeBytes: 353_086,
      updated: "2013-11-11T00:00:00.000Z",
      thumbsUp: 419,
      thumbsDown: 17,
      tooNewForRating: false,
      notes: 46,
      audio: 46,
      images: 0,
      itemsSharedByAuthor: 8,
    });
    expect(deck.description).toMatch(/^This deck was modified from the TextFugu Hiragana deck\./u);
    expect(deck.downloadKey).toMatch(/^eyJ/u);
    expect(deck.reviews).toHaveLength(401);
  });

  it("resolves the media sample notes name to AnkiWeb URLs", async () => {
    expect.assertions(2);
    const deck = decodeItemInfo(114_060_567, await fixture("item-info-114060567.bin"));
    expect(deck.sampleNotes[0]?.media).toStrictEqual([
      "https://ankiweb.net/shared/mpreview/114060567/0.mp3",
      "https://ankiweb.net/shared/mpreview/114060567/1.jpg",
    ]);
    expect(deck.sampleNotes[0]?.fields).toContainEqual({
      name: "Image_URI",
      value: "[image:1.jpg]",
    });
  });

  it("throws for an id with no listing", async () => {
    expect.assertions(1);
    const body = await fixture("item-info-missing.bin");
    expect(() => decodeItemInfo(1, body)).toThrow("AnkiWeb has no shared item 1");
  });
});

describe("the shared deck catalogue", () => {
  it("serves a repeated search from cache until max-age runs out", async () => {
    expect.assertions(3);
    let now = 0;
    const fake = fakeFetch(async () => fixtureResponse("list-decks-japanese.bin"));
    const shared = new SharedDecks({ fetch: fake.fetch, now: () => now });
    await shared.search("japanese");
    now = 599_999;
    await shared.search("japanese");
    expect(fake.urls).toStrictEqual(["https://ankiweb.net/svc/shared/list-decks?search=japanese"]);
    now = 600_000;
    await shared.search("japanese");
    expect(fake.urls).toHaveLength(2);
    await shared.search("spanish verbs");
    expect(fake.urls[2]).toBe("https://ankiweb.net/svc/shared/list-decks?search=spanish+verbs");
  });

  it("does not cache a response without max-age", async () => {
    expect.assertions(1);
    const fake = fakeFetch(async () => new Response(new Uint8Array()));
    const shared = new SharedDecks({ fetch: fake.fetch });
    await shared.search("japanese");
    await shared.search("japanese");
    expect(fake.urls).toHaveLength(2);
  });

  it("turns a 429 into an error that says to wait", async () => {
    expect.assertions(2);
    const fake = fakeFetch(async () => new Response("Failed to parse input.", { status: 429 }));
    const shared = new SharedDecks({ fetch: fake.fetch });
    const failure = shared.search("japanese");
    await expect(failure).rejects.toThrow(AnkiWebHttpError);
    await expect(failure).rejects.toThrow(/rate-limiting/u);
  });

  it("reports any other failure with AnkiWeb's reason", async () => {
    expect.assertions(1);
    const fake = fakeFetch(async () => new Response("boom", { status: 500 }));
    const shared = new SharedDecks({ fetch: fake.fetch });
    await expect(shared.get(1)).rejects.toThrow("AnkiWeb answered 500: boom");
  });

  it("asks for a listing by its shared id", async () => {
    expect.assertions(2);
    const fake = fakeFetch(async () => fixtureResponse("item-info-2183294427.bin"));
    const shared = new SharedDecks({ fetch: fake.fetch });
    const deck = await shared.get(2_183_294_427);
    expect(deck.title).toBe("Japanese Basic Hiragana");
    expect(fake.urls).toStrictEqual([
      "https://ankiweb.net/svc/shared/item-info?sharedId=2183294427",
    ]);
  });
});
