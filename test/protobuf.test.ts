import { describe, expect, it } from "vitest";

import {
  decodeMessage,
  ProtobufError,
  readBool,
  readMessages,
  readNumber,
  readString,
} from "../src/ankiweb/protobuf.js";

describe("decodeMessage", () => {
  it("reads multi-byte varints, including an int64 past 2^32", () => {
    expect.assertions(2);
    // Field 1 = 300, field 2 = 1_791_280_883_007.
    const message = decodeMessage(
      Uint8Array.of(0x08, 0xac, 0x02, 0x10, 0xbf, 0xca, 0xa4, 0x85, 0x91, 0x34),
    );
    expect(readNumber(message, 1)).toBe(300);
    expect(readNumber(message, 2)).toBe(1_791_280_883_007);
  });

  it("reads strings, nested messages and repeated fields", () => {
    expect.assertions(2);
    // Field 1 = "hi", then field 2 twice, each holding { 1: true }.
    const message = decodeMessage(
      Uint8Array.of(0x0a, 0x02, 0x68, 0x69, 0x12, 0x02, 0x08, 0x01, 0x12, 0x02, 0x08, 0x01),
    );
    expect(readString(message, 1)).toBe("hi");
    expect(readMessages(message, 2).map((nested) => readBool(nested, 1))).toStrictEqual([
      true,
      true,
    ]);
  });

  it("skips fixed-width fields", () => {
    expect.assertions(1);
    // Field 1 as fixed32, then field 2 = 7.
    const message = decodeMessage(Uint8Array.of(0x0d, 1, 2, 3, 4, 0x10, 0x07));
    expect(readNumber(message, 2)).toBe(7);
  });

  it("reads what protobuf leaves out as absent", () => {
    expect.assertions(3);
    const message = decodeMessage(new Uint8Array());
    expect(readNumber(message, 1)).toBeUndefined();
    expect(readBool(message, 1)).toBe(false);
    expect(readMessages(message, 1)).toStrictEqual([]);
  });

  it("rejects a truncated message", () => {
    expect.assertions(2);
    expect(() => decodeMessage(Uint8Array.of(0x08, 0x80))).toThrow(ProtobufError);
    expect(() => decodeMessage(Uint8Array.of(0x0a, 0x05, 0x68))).toThrow(ProtobufError);
  });

  it("rejects reading a field as the wrong kind", () => {
    expect.assertions(1);
    expect(() => readString(decodeMessage(Uint8Array.of(0x08, 0x01)), 1)).toThrow(ProtobufError);
  });
});
