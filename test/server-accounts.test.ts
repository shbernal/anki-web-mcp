import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_ACCOUNT } from "../src/data-dir.js";
import { textOf } from "./connect.js";
import { connect, fakeOf, hold, release, store, setUp, tearDown } from "./several-accounts.js";

beforeEach(setUp);
afterEach(tearDown);

describe("several accounts in one server", () => {
  it("acts as the account named, and as the default without one", async () => {
    expect.assertions(2);
    await store(DEFAULT_ACCOUNT, "second");
    const client = await connect();
    const mine = await client.callTool({ name: "list_my_decks" });
    const theirs = await client.callTool({
      name: "list_my_decks",
      arguments: { account: "second" },
    });
    expect(textOf(mine.content)).toContain("default deck");
    expect(textOf(theirs.content)).toContain("second deck");
    await client.close();
  });

  it("lists the shared decks of the account named", async () => {
    expect.assertions(2);
    await store(DEFAULT_ACCOUNT, "second");
    const client = await connect();
    const mine = await client.callTool({ name: "list_my_shared_decks" });
    const theirs = await client.callTool({
      name: "list_my_shared_decks",
      arguments: { account: "second" },
    });
    expect(textOf(mine.content)).toContain("default listing");
    expect(textOf(theirs.content)).toContain("second listing");
    await client.close();
  });

  it("does not queue one account's call behind another's", async () => {
    expect.assertions(2);
    await store(DEFAULT_ACCOUNT, "second");
    hold(DEFAULT_ACCOUNT);
    const client = await connect();
    const slow = client.callTool({ name: "list_my_decks" });
    const fast = await client.callTool({ name: "list_my_decks", arguments: { account: "second" } });
    expect(textOf(fast.content)).toContain("second deck");
    release();
    const finished = await slow;
    expect(textOf(finished.content)).toContain("default deck");
    await client.close();
  });

  it("refuses an account that is not stored, listing those that are", async () => {
    expect.assertions(2);
    await store(DEFAULT_ACCOUNT, "second");
    const client = await connect();
    const result = await client.callTool({ name: "list_my_decks", arguments: { account: "work" } });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toContain(
      'No AnkiWeb account named "work". Accounts: default, second. Add one with `anki-web-mcp --login --account work`',
    );
    await client.close();
  });

  it("names --account in the sign-in advice for a named account only", async () => {
    expect.assertions(2);
    await store(DEFAULT_ACCOUNT, "second");
    const client = await connect([DEFAULT_ACCOUNT, "second"]);
    const mine = await client.callTool({ name: "list_my_decks" });
    const theirs = await client.callTool({
      name: "list_my_decks",
      arguments: { account: "second" },
    });
    expect(textOf(mine.content)).toContain("Run `anki-web-mcp --login` in a terminal");
    expect(textOf(theirs.content)).toContain("Run `anki-web-mcp --login --account second`");
    await client.close();
  });

  it("closes one account's browser, or every one open", async () => {
    expect.assertions(4);
    await store(DEFAULT_ACCOUNT, "second");
    const client = await connect();
    await client.callTool({ name: "list_my_decks" });
    await client.callTool({ name: "list_my_decks", arguments: { account: "second" } });
    const one = await client.callTool({ name: "close_session", arguments: { account: "second" } });
    expect(one.structuredContent).toStrictEqual({ closed: true });
    expect(fakeOf(DEFAULT_ACCOUNT)?.fake.closed()).toBe(false);
    const all = await client.callTool({ name: "close_session" });
    expect(all.structuredContent).toStrictEqual({ closed: true });
    expect(fakeOf(DEFAULT_ACCOUNT)?.fake.closed()).toBe(true);
    await client.close();
  });

  it("reports every account, validating only the one named", async () => {
    expect.assertions(2);
    await store(DEFAULT_ACCOUNT, "second");
    const client = await connect(["second"]);
    const result = await client.callTool({
      name: "server_status",
      arguments: { account: "second", validate: true },
    });
    expect(result.structuredContent).toMatchObject({
      accounts: [
        { name: "default", sessionStored: true, lastValidated: "2026-10-06T12:00:00.000Z" },
        { name: "second", sessionStored: true, authenticated: false },
      ],
    });
    expect(fakeOf(DEFAULT_ACCOUNT)?.launches).toBe(0);
    await client.close();
  });
});
