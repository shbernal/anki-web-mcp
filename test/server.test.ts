import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Client } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { SharedDecks } from "../src/ankiweb/shared.js";
import { writeStoredSession } from "../src/browser/cookies.js";
import {
  type AccountPaths,
  accountPaths,
  type DataDir,
  DEFAULT_ACCOUNT,
  ensureDataDir,
  resolveDataDir,
} from "../src/data-dir.js";
import { version } from "../src/version.js";
import { connectedClient as connect, textOf } from "./connect.js";
import { fakeFetch, fixtureResponse } from "./fake-fetch.js";

const VALIDATED_AT = "2026-10-06T12:00:00.000Z";

let scratch: string;
let dataDir: DataDir;
let account: AccountPaths;

const rating = z.object({ thumbsUp: z.number(), thumbsDown: z.number() });
const ratedResults = z.object({ results: z.array(rating) });
/** Answers searches with the recorded `japanese` results and listings with the recorded deck. */
function recordedSharedDecks(): SharedDecks {
  const fake = fakeFetch(async (url) =>
    fixtureResponse(
      url.includes("list-decks") ? "list-decks-japanese.bin" : "item-info-2183294427.bin",
    ),
  );
  return new SharedDecks({ fetch: fake.fetch });
}

async function connectedClient(
  sharedDecks = recordedSharedDecks(),
  readOnly = false,
): Promise<Client> {
  return connect({ dataDir, sharedDecks, readOnly });
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-"));
  dataDir = resolveDataDir(join(scratch, "data"));
  account = accountPaths(dataDir, DEFAULT_ACCOUNT);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("server", () => {
  it("lists its tools", async () => {
    expect.assertions(1);
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools).toMatchObject([
      { name: "server_status" },
      { name: "search_shared_decks" },
      { name: "get_shared_deck" },
      { name: "download_shared_deck" },
      { name: "convert_deck_to_markdown" },
      { name: "list_my_decks" },
      { name: "list_my_shared_decks" },
      {
        name: "share_deck",
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      {
        name: "unshare_deck",
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      { name: "close_session" },
    ]);
    await client.close();
  });

  it("lists no tool that acts on AnkiWeb when read-only", async () => {
    expect.assertions(1);
    const client = await connectedClient(recordedSharedDecks(), true);
    const { tools } = await client.listTools();
    // An array matches only at the same length, so share_deck is absent.
    expect(tools).toMatchObject([
      { name: "server_status" },
      { name: "search_shared_decks" },
      { name: "get_shared_deck" },
      { name: "download_shared_deck" },
      { name: "convert_deck_to_markdown" },
      { name: "list_my_decks" },
      { name: "list_my_shared_decks" },
      { name: "close_session" },
    ]);
    await client.close();
  });

  it("says it is read-only in its status", async () => {
    expect.assertions(2);
    const client = await connectedClient(recordedSharedDecks(), true);
    const result = await client.callTool({ name: "server_status" });
    expect(result.structuredContent).toStrictEqual({
      version,
      dataDir: dataDir.root,
      downloadsDir: dataDir.downloads,
      accounts: [{ name: "default", sessionStored: false }],
      readOnly: true,
    });
    expect(textOf(result.content)).toContain("Read-only");
    await client.close();
  });

  it("reports the package version and no stored session", async () => {
    expect.assertions(1);
    const client = await connectedClient();
    const result = await client.callTool({ name: "server_status" });
    expect(result.structuredContent).toStrictEqual({
      version,
      dataDir: dataDir.root,
      downloadsDir: dataDir.downloads,
      accounts: [{ name: "default", sessionStored: false }],
    });
    await client.close();
  });

  it("reports a stored session and when it was last validated", async () => {
    expect.assertions(1);
    await ensureDataDir(dataDir);
    await writeStoredSession(account.cookies, {
      validatedAt: VALIDATED_AT,
      cookies: [
        {
          name: "ankiweb",
          value: "token",
          domain: "ankiweb.net",
          path: "/",
          expires: 0,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ],
    });
    const client = await connectedClient();
    const result = await client.callTool({ name: "server_status", arguments: { validate: true } });
    expect(result.structuredContent).toStrictEqual({
      version,
      dataDir: dataDir.root,
      downloadsDir: dataDir.downloads,
      accounts: [
        { name: "default", sessionStored: true, lastValidated: VALIDATED_AT, authenticated: false },
      ],
    });
    await client.close();
  });
});

describe("search_shared_decks", () => {
  it("sorts by rating and pages the results", async () => {
    expect.assertions(4);
    const client = await connectedClient();
    const result = await client.callTool({
      name: "search_shared_decks",
      arguments: { query: "japanese", page: 2, limit: 3 },
    });
    expect(result.structuredContent).toMatchObject({
      query: "japanese",
      total: 1899,
      page: 2,
      hasMore: true,
    });
    const { results } = ratedResults.parse(result.structuredContent);
    const ratings = results.map((row) => row.thumbsUp - row.thumbsDown);
    expect(ratings).toHaveLength(3);
    expect(ratings).toStrictEqual(ratings.toSorted((left, right) => right - left));
    expect(textOf(result.content)).toMatch(/^1899 shared decks match "japanese"; showing 4-6\./u);
    await client.close();
  });

  it("reports a page past the end as empty", async () => {
    expect.assertions(1);
    const client = await connectedClient();
    const result = await client.callTool({
      name: "search_shared_decks",
      arguments: { query: "japanese", page: 100, limit: 100 },
    });
    expect(result.structuredContent).toMatchObject({ hasMore: false, results: [] });
    await client.close();
  });

  it("returns AnkiWeb's rate limit as a tool error", async () => {
    expect.assertions(2);
    const limited = fakeFetch(async () => new Response("Failed to parse input.", { status: 429 }));
    const client = await connectedClient(new SharedDecks({ fetch: limited.fetch }));
    const result = await client.callTool({
      name: "search_shared_decks",
      arguments: { query: "japanese" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/rate-limiting/u);
    await client.close();
  });
});

describe("get_shared_deck", () => {
  it("takes a link and leaves out the download key", async () => {
    expect.assertions(3);
    const client = await connectedClient();
    const result = await client.callTool({
      name: "get_shared_deck",
      arguments: { deck: "https://ankiweb.net/shared/info/2183294427" },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      id: 2_183_294_427,
      title: "Japanese Basic Hiragana",
      notes: 46,
      reviewCount: 401,
      reviews: { length: 10 },
    });
    expect(result.structuredContent).not.toHaveProperty("downloadKey");
    await client.close();
  });

  it("includes as many reviews as asked for", async () => {
    expect.assertions(1);
    const client = await connectedClient();
    const result = await client.callTool({
      name: "get_shared_deck",
      arguments: { deck: "2183294427", reviews: 0 },
    });
    expect(result.structuredContent).toMatchObject({ reviewCount: 401, reviews: [] });
    await client.close();
  });

  it("rejects something that is not a shared deck", async () => {
    expect.assertions(2);
    const client = await connectedClient();
    const result = await client.callTool({
      name: "get_shared_deck",
      arguments: { deck: "https://ankiweb.net/decks" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/neither a shared deck id nor/u);
    await client.close();
  });
});
