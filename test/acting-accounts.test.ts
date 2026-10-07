import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_ACCOUNT } from "../src/data-dir.js";
import { textOf } from "./connect.js";
import { connect, store, setUp, tearDown } from "./several-accounts.js";

beforeEach(setUp);
afterEach(tearDown);

describe("share_deck with several accounts", () => {
  const preview = { deck: "default deck", title: "A deck", description: "For a test." };

  it("leaves the account out of the preview with one account", async () => {
    expect.assertions(2);
    await store(DEFAULT_ACCOUNT);
    const client = await connect();
    const result = await client.callTool({ name: "share_deck", arguments: preview });
    expect(result.structuredContent).not.toHaveProperty("account");
    expect(textOf(result.content)).not.toContain("Account:");
    await client.close();
  });

  it("names the account in the preview and the go-ahead", async () => {
    expect.assertions(2);
    await store(DEFAULT_ACCOUNT, "second");
    const client = await connect();
    const result = await client.callTool({ name: "share_deck", arguments: preview });
    expect(result.structuredContent).toMatchObject({ status: "preview", account: "default" });
    expect(textOf(result.content)).toContain('confirm: true and account: "default"');
    await client.close();
  });

  it("refuses to publish without the account named", async () => {
    expect.assertions(2);
    await store(DEFAULT_ACCOUNT, "second");
    const client = await connect();
    const result = await client.callTool({
      name: "share_deck",
      arguments: { ...preview, confirm: true },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toContain("Nothing was published. Several AnkiWeb accounts");
    await client.close();
  });
});

describe("unshare_deck with several accounts", () => {
  it("names the account in the preview and the go-ahead", async () => {
    expect.assertions(2);
    await store(DEFAULT_ACCOUNT, "second");
    const client = await connect();
    const result = await client.callTool({
      name: "unshare_deck",
      arguments: { listing: "second listing", account: "second" },
    });
    expect(result.structuredContent).toMatchObject({ status: "preview", account: "second" });
    expect(textOf(result.content)).toContain('confirm: true and account: "second"');
    await client.close();
  });

  it("refuses to remove without the account named", async () => {
    expect.assertions(2);
    await store(DEFAULT_ACCOUNT, "second");
    const client = await connect();
    const result = await client.callTool({
      name: "unshare_deck",
      arguments: { listing: "default listing", confirm: true },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/^Nothing was removed\. Several AnkiWeb accounts/u);
    await client.close();
  });
});

describe("delete_deck with several accounts", () => {
  it("names the account in the preview and the go-ahead", async () => {
    expect.assertions(2);
    await store(DEFAULT_ACCOUNT, "second");
    const client = await connect();
    const result = await client.callTool({
      name: "delete_deck",
      arguments: { deck: "second deck", account: "second" },
    });
    expect(result.structuredContent).toMatchObject({ status: "preview", account: "second" });
    expect(textOf(result.content)).toContain('confirm: true, account: "second"');
    await client.close();
  });

  it("refuses to delete without the account named", async () => {
    expect.assertions(2);
    await store(DEFAULT_ACCOUNT, "second");
    const client = await connect();
    const result = await client.callTool({
      name: "delete_deck",
      arguments: { deck: "7", confirm: true },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/^Nothing was deleted\. Several AnkiWeb accounts/u);
    await client.close();
  });
});
