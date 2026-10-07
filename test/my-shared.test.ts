import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { decodeMySharedItems } from "../src/ankiweb/my-shared.js";
import { encodeMessage } from "../src/ankiweb/protobuf.js";

/** The day both recorded listings were last shared. */
const RECORDED_DAY = "2026-10-07T00:00:00.000Z";

async function fixture(name: string): Promise<Uint8Array> {
  return readFile(new URL(`fixtures/ankiweb/${name}`, import.meta.url));
}

describe("decodeMySharedItems", () => {
  it("reads the recorded list of one listing, with no ratings or downloads yet", async () => {
    expect.assertions(1);
    expect(decodeMySharedItems(await fixture("list-mine-one.bin"))).toStrictEqual([
      {
        id: 260_296_473,
        title: "anki-web-mcp test, please ignore",
        thumbsUp: 0,
        thumbsDown: 0,
        downloads: 0,
        modified: RECORDED_DAY,
      },
    ]);
  });

  it("keeps the recorded order of two listings, newest first", async () => {
    expect.assertions(1);
    const items = decodeMySharedItems(await fixture("list-mine-two.bin"));
    expect(items.map(({ id }) => id)).toStrictEqual([1_606_750_520, 260_296_473]);
  });

  it("reads the recorded empty body as no listings", async () => {
    expect.assertions(1);
    expect(decodeMySharedItems(await fixture("list-mine-empty.bin"))).toStrictEqual([]);
  });

  it("reads ratings and downloads", () => {
    expect.assertions(1);
    const item = encodeMessage([
      [1, 5],
      [2, "Rated"],
      [3, 12],
      [4, 2],
      [5, 1_791_331_200n],
      [6, 340],
    ]);
    expect(decodeMySharedItems(encodeMessage([[1, item]]))).toStrictEqual([
      {
        id: 5,
        title: "Rated",
        thumbsUp: 12,
        thumbsDown: 2,
        downloads: 340,
        modified: RECORDED_DAY,
      },
    ]);
  });
});
