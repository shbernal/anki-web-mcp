import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { dispositionFilename } from "../src/ankiweb/disposition.js";
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

  it("tells sounds from images by the tag that names them", async () => {
    expect.assertions(1);
    const deck = decodeItemInfo(114_060_567, await fixture("item-info-114060567.bin"));
    expect(deck).toMatchObject({
      audio: 405,
      images: 235,
      samplesCarry: { audio: true, images: true },
    });
  });

  it("keeps AnkiWeb's media counts when the samples contradict them", async () => {
    expect.assertions(2);
    const deck = decodeItemInfo(9_239_409, await fixture("item-info-9239409.bin"));
    expect(deck).toMatchObject({
      audio: 0,
      images: 0,
      samplesCarry: { audio: true, images: true },
    });
    expect(deck.sampleNotes[0]?.media).toContainEqual(
      expect.stringMatching(/^https:\/\/ankiweb\.net\/shared\/mpreview\/9239409\/.+\.webp$/u),
    );
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

describe("dispositionFilename", () => {
  it("reads the plain, quoted and RFC 5987 forms", () => {
    expect.assertions(3);
    expect(dispositionFilename("attachment; filename=Japanese_Basic.apkg")).toBe(
      "Japanese_Basic.apkg",
    );
    expect(dispositionFilename('attachment; filename="a b.apkg"')).toBe("a b.apkg");
    expect(
      dispositionFilename("attachment; filename=x.apkg; filename*=UTF-8''%E6%97%A5%E6%9C%AC.apkg"),
    ).toBe("日本.apkg");
  });
});

/** The recorded listing for its item-info request, and a zip header for anything else. */
async function listingThenDeck(url: string): Promise<Response> {
  if (url.includes("item-info")) {
    return fixtureResponse("item-info-2183294427.bin");
  }
  return new Response(Uint8Array.of(0x50, 0x4b, 0x03, 0x04), {
    headers: { "content-disposition": "attachment; filename=Japanese_Basic_Hiragana.apkg" },
  });
}

describe("downloading a shared deck", () => {
  it("fetches the deck with the listing's download key", async () => {
    expect.assertions(3);
    const fake = fakeFetch(listingThenDeck);
    const download = await new SharedDecks({ fetch: fake.fetch }).download(2_183_294_427);
    expect(download.deck).toStrictEqual({ id: 2_183_294_427, title: "Japanese Basic Hiragana" });
    expect(download.suggestedFilename).toBe("Japanese_Basic_Hiragana.apkg");
    expect(fake.urls[1]).toMatch(
      /^https:\/\/ankiweb\.net\/svc\/shared\/download-deck\/2183294427\?t=eyJ/u,
    );
  });

  it("refuses an add-on", async () => {
    expect.assertions(2);
    // ItemInfoResponse { available { title = "Add-on" } }, with no deck in it.
    const addon = Uint8Array.of(0x0a, 0x08, 0x2a, 0x06, ...new TextEncoder().encode("Add-on"));
    const fake = fakeFetch(async () => new Response(addon));
    await expect(new SharedDecks({ fetch: fake.fetch }).download(1)).rejects.toThrow(
      /is an add-on/u,
    );
    expect(fake.urls).toHaveLength(1);
  });
});
