import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  decodeMessage,
  encodeMessage,
  readBool,
  readNumber,
  readString,
} from "../src/ankiweb/protobuf.js";
import {
  decodeShareInfo,
  decodeShareState,
  encodeShareRequest,
  shareProblems,
} from "../src/ankiweb/share.js";
import { nested } from "./nested.js";

const DECK_ID = 1_791_280_883_007;
const LISTING = {
  title: "Test deck",
  description: "Made for a test.",
  tags: "test sample",
  supportUrl: "",
};

function state(value: number, sharedId?: number): Uint8Array {
  return encodeMessage([
    [1, value],
    [2, sharedId],
  ]);
}

describe("share messages", () => {
  it("reads a never-shared deck's form as empty", async () => {
    expect.assertions(1);
    const body = await readFile(
      new URL("fixtures/ankiweb/deck-share-info-never-shared.bin", import.meta.url),
    );
    expect(decodeShareInfo(body, DECK_ID)).toStrictEqual({
      deckId: DECK_ID,
      metadata: { title: "", tags: "", supportUrl: "", description: "" },
      shareCount: 0,
    });
  });

  it("reads a shared deck's listing back, with its padded tags trimmed", async () => {
    expect.assertions(1);
    const body = await readFile(
      new URL("fixtures/ankiweb/deck-share-info-shared.bin", import.meta.url),
    );
    expect(decodeShareInfo(body, 1_791_308_364_616)).toStrictEqual({
      deckId: 1_791_308_364_616,
      metadata: {
        title: "anki-web-mcp test, please ignore",
        tags: "test",
        supportUrl: "",
        description: "A throwaway deck published to test a tool. It will be removed shortly.",
      },
      sharedId: 260_296_473,
      shareCount: 1,
    });
  });

  it("reads an earlier share's id and the weekly count", () => {
    expect.assertions(2);
    const metadata = encodeMessage([
      [1, "Old"],
      [2, " a b "],
      [5, BigInt(DECK_ID)],
      [6, 99],
    ]);
    const response = encodeMessage([
      [1, metadata],
      [3, 4],
    ]);
    const info = decodeShareInfo(response, DECK_ID);
    expect(info).toMatchObject({ sharedId: 99, shareCount: 4 });
    expect(info.metadata).toMatchObject({ title: "Old", tags: "a b" });
  });

  it("writes the listing and the copyright declaration", () => {
    expect.assertions(3);
    const request = decodeMessage(encodeShareRequest(DECK_ID, LISTING));
    const metadata = nested(request, 1);
    expect(readString(metadata, 1)).toBe(LISTING.title);
    expect(readNumber(metadata, 5)).toBe(DECK_ID);
    expect(readBool(request, 2)).toBe(true);
  });

  it("reads the share state, and treats an unknown one as an error", () => {
    expect.assertions(3);
    expect(decodeShareState(new Uint8Array())).toStrictEqual({ state: "none" });
    expect(decodeShareState(state(3, 42))).toStrictEqual({ state: "success", sharedId: 42 });
    expect(decodeShareState(state(5))).toStrictEqual({ state: "error" });
  });

  it("lists what the form would refuse", () => {
    expect.assertions(2);
    expect(shareProblems(LISTING, 0)).toStrictEqual([]);
    expect(shareProblems({ ...LISTING, title: "x".repeat(61), description: " " }, 20)).toHaveLength(
      3,
    );
  });
});
