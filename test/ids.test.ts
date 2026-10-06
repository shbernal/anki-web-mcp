import { describe, expect, it } from "vitest";

import { InvalidSharedIdError, parseSharedId } from "../src/ankiweb/ids.js";

describe("parseSharedId", () => {
  it.each([
    "2183294427",
    " 2183294427 ",
    "https://ankiweb.net/shared/info/2183294427",
    "https://ankiweb.net/shared/info/2183294427/",
    "https://ankiweb.net/shared/info/2183294427?ref=x#reviews",
    "ankiweb.net/shared/info/2183294427",
    "/shared/info/2183294427",
  ])("reads %j", (input) => {
    expect.assertions(1);
    expect(parseSharedId(input)).toBe(2_183_294_427);
  });

  it.each([
    "",
    "0",
    "4294967296",
    "12a",
    "https://example.com/shared/info/1",
    "https://ankiweb.net/decks/1",
    "https://ankiweb.net/shared/info/abc",
  ])("rejects %j", (input) => {
    expect.assertions(1);
    expect(() => parseSharedId(input)).toThrow(InvalidSharedIdError);
  });
});
