import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SharedDecks } from "../src/ankiweb/shared.js";
import { type DataDir, resolveDataDir } from "../src/data-dir.js";
import { connectedClient, textOf } from "./connect.js";
import { fakeFetch, fixtureResponse } from "./fake-fetch.js";

const APKG = Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00);
const FILENAME = "Japanese_Basic_Hiragana.apkg";
const SESSION_COOKIE = {
  name: "ankiweb",
  value: "token",
  domain: "ankiweb.net",
  path: "/",
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
} as const;
const DOWNLOAD = { name: "download_shared_deck", arguments: { deck: "2183294427" } };

let scratch: string;
let dataDir: DataDir;

function deck(): Response {
  return new Response(APKG, {
    headers: { "content-disposition": `attachment; filename=${FILENAME}` },
  });
}

/** Serves the recorded listing, and the deck to whoever `allowed` lets through. */
function catalogue(allowed: (cookie: string | undefined) => boolean): SharedDecks {
  const fake = fakeFetch(async (url, cookie) => {
    if (url.includes("item-info")) {
      return fixtureResponse("item-info-2183294427.bin");
    }
    return allowed(cookie)
      ? deck()
      : new Response("Please log in to download more decks.", { status: 429 });
  });
  return new SharedDecks({ fetch: fake.fetch });
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-"));
  dataDir = resolveDataDir(join(scratch, "data"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("download_shared_deck", () => {
  it("saves the deck to the downloads directory under AnkiWeb's name", async () => {
    expect.assertions(2);
    const client = await connectedClient({ dataDir, sharedDecks: catalogue(() => true) });
    const result = await client.callTool(DOWNLOAD);
    const path = join(dataDir.downloads, FILENAME);
    expect(result.structuredContent).toStrictEqual({
      path,
      filename: FILENAME,
      bytes: APKG.length,
      deck: { id: 2_183_294_427, title: "Japanese Basic Hiragana" },
    });
    await expect(readFile(path)).resolves.toStrictEqual(Buffer.from(APKG));
    await client.close();
  });

  it("numbers a second download of the same deck", async () => {
    expect.assertions(1);
    const client = await connectedClient({ dataDir, sharedDecks: catalogue(() => true) });
    await client.callTool(DOWNLOAD);
    const second = await client.callTool(DOWNLOAD);
    expect(second.structuredContent).toMatchObject({
      filename: "Japanese_Basic_Hiragana (1).apkg",
    });
    await client.close();
  });

  it("retries with the session once AnkiWeb asks for a login", async () => {
    expect.assertions(2);
    const client = await connectedClient({
      dataDir,
      sharedDecks: catalogue((cookie) => cookie === "ankiweb=token"),
      loggedIn: true,
      cookies: [SESSION_COOKIE],
    });
    const result = await client.callTool(DOWNLOAD);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ filename: FILENAME });
    await client.close();
  });

  it("explains the login AnkiWeb asks for when there is no session", async () => {
    expect.assertions(2);
    const client = await connectedClient({ dataDir, sharedDecks: catalogue(() => false) });
    const result = await client.callTool(DOWNLOAD);
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/only a few downloads without signing in.*--login/u);
    await client.close();
  });

  it("refuses a relative directory", async () => {
    expect.assertions(2);
    const client = await connectedClient({ dataDir, sharedDecks: catalogue(() => true) });
    const result = await client.callTool({
      name: "download_shared_deck",
      arguments: { deck: "2183294427", directory: "decks" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/not an absolute path/u);
    await client.close();
  });
});

describe("list_my_decks", () => {
  it("lists the signed-in user's decks", async () => {
    expect.assertions(1);
    const body = await readFile(
      new URL("fixtures/ankiweb/deck-list-info-default-only.bin", import.meta.url),
    );
    const client = await connectedClient({
      dataDir,
      sharedDecks: catalogue(() => true),
      loggedIn: true,
      respond: async () => ({ status: 200, body }),
    });
    const result = await client.callTool({ name: "list_my_decks" });
    expect(result.structuredContent).toMatchObject({
      decks: [{ id: 1, name: "Default", level: 1 }],
      currentDeckId: 1,
    });
    await client.close();
  });

  it("says to sign in when there is no session", async () => {
    expect.assertions(2);
    const client = await connectedClient({ dataDir, sharedDecks: catalogue(() => true) });
    const result = await client.callTool({ name: "list_my_decks" });
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/anki-web-mcp --login/u);
    await client.close();
  });
});
