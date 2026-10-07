import { describe, expect, it } from "vitest";

import { READ_ONLY_ENV, readOnlyMode } from "../src/server.js";

const env = (value: string | undefined) => ({ [READ_ONLY_ENV]: value });

describe("readOnlyMode", () => {
  it("is off with neither the flag nor the environment", () => {
    expect.assertions(1);
    expect(readOnlyMode(undefined, {})).toBe(false);
  });

  it.each([
    ["1", true],
    ["true", true],
    ["TRUE", true],
    ["", false],
    ["0", false],
    ["False", false],
  ])("reads %j from the environment as %s", (value, expected) => {
    expect.assertions(1);
    expect(readOnlyMode(undefined, env(value))).toBe(expected);
  });

  it.each([true, false])("lets the flag, set to %s, win over the environment", (flag) => {
    expect.assertions(2);
    expect(readOnlyMode(flag, env("1"))).toBe(flag);
    expect(readOnlyMode(flag, env("0"))).toBe(flag);
  });

  it("reports any other environment value as usage", () => {
    expect.assertions(1);
    expect(readOnlyMode(undefined, env("yes"))).toStrictEqual({
      usage: `${READ_ONLY_ENV} takes 1, true, 0 or false`,
    });
  });

  it("ignores a bad environment value when the flag is given", () => {
    expect.assertions(1);
    expect(readOnlyMode(true, env("yes"))).toBe(true);
  });
});
