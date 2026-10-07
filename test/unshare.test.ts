import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decodeMessage, encodeMessage, readNumber } from "../src/ankiweb/protobuf.js";
import { SharedDecks } from "../src/ankiweb/shared.js";
import { type DataDir, resolveDataDir } from "../src/data-dir.js";
import { connectedClient, textOf } from "./connect.js";
import type { FakeReply } from "./fake-context.js";

const LISTING_ID = 1_606_750_520;

interface Listing {
  readonly id: number;
  readonly title: string;
}

const LISTINGS: readonly Listing[] = [
  { id: LISTING_ID, title: "Test deck" },
  { id: 2, title: "Twin" },
  { id: 3, title: "Twin" },
];

let scratch: string;
let dataDir: DataDir;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-"));
  dataDir = resolveDataDir(join(scratch, "data"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function listMine(listings: readonly Listing[]): Uint8Array {
  return encodeMessage(
    listings.map(({ id, title }) => [
      1,
      encodeMessage([
        [1, id],
        [2, title],
        [3, 4],
        [6, 25],
      ]),
    ]),
  );
}

interface Posted {
  readonly path: string;
  readonly body: Uint8Array;
}

/**
 * Answers `list-mine` with what is still listed, and takes a listing off on
 * `remove-item` unless `sticky`, the way AnkiWeb would fail to. Either way
 * `remove-item` answers an empty `200`, as AnkiWeb does.
 */
function ankiWeb(sticky = false): {
  readonly posted: Posted[];
  readonly respond: (url: string, body: Uint8Array) => Promise<FakeReply>;
} {
  const posted: Posted[] = [];
  let listed = [...LISTINGS];
  const respond = async (url: string, body: Uint8Array): Promise<FakeReply> => {
    const path = new URL(url).pathname;
    posted.push({ path, body });
    if (path.endsWith("/list-mine")) {
      return { status: 200, body: listMine(listed) };
    }
    if (path.endsWith("/remove-item") && !sticky) {
      const id = readNumber(decodeMessage(body), 1);
      listed = listed.filter((listing) => listing.id !== id);
    }
    return { status: 200, body: new Uint8Array() };
  };
  return { posted, respond };
}

async function unshareClient(sticky = false): Promise<{
  readonly client: Awaited<ReturnType<typeof connectedClient>>;
  readonly posted: Posted[];
}> {
  const { posted, respond } = ankiWeb(sticky);
  const client = await connectedClient({
    dataDir,
    sharedDecks: new SharedDecks(),
    loggedIn: true,
    respond,
  });
  return { client, posted };
}

function paths(posted: readonly Posted[]): string[] {
  return posted.map(({ path }) => path);
}

/** The shared ids `remove-item` was posted for. */
function removedIds(posted: readonly Posted[]): (number | undefined)[] {
  return posted
    .filter(({ path }) => path.endsWith("/remove-item"))
    .map(({ body }) => readNumber(decodeMessage(body), 1));
}

function unshare(
  listing: string,
  confirm = false,
): {
  name: string;
  arguments: Record<string, unknown>;
} {
  return { name: "unshare_deck", arguments: { listing, confirm } };
}

describe("unshare_deck", () => {
  it("previews without removing anything", async () => {
    expect.assertions(4);
    const { client, posted } = await unshareClient();
    const result = await client.callTool(unshare(String(LISTING_ID)));
    expect(result.structuredContent).toStrictEqual({
      status: "preview",
      listing: {
        id: LISTING_ID,
        title: "Test deck",
        url: `https://ankiweb.net/shared/info/${LISTING_ID}`,
        downloads: 25,
        thumbsUp: 4,
        thumbsDown: 0,
      },
    });
    expect(textOf(result.content)).toMatch(/^Preview only: nothing was removed\./u);
    expect(textOf(result.content)).toContain("The deck stays in the collection.");
    expect(paths(posted)).toStrictEqual(["/svc/shared/list-mine"]);
    await client.close();
  });

  it("removes on confirm and checks the listing is gone", async () => {
    expect.assertions(3);
    const { client, posted } = await unshareClient();
    const result = await client.callTool(unshare(String(LISTING_ID), true));
    expect(result.structuredContent).toMatchObject({ status: "removed" });
    expect(paths(posted)).toStrictEqual([
      "/svc/shared/list-mine",
      "/svc/shared/remove-item",
      "/svc/shared/list-mine",
    ]);
    expect(removedIds(posted)).toStrictEqual([LISTING_ID]);
    await client.close();
  });

  it.each([
    ["a bare id", String(LISTING_ID)],
    ["a link", `https://ankiweb.net/shared/info/${LISTING_ID}`],
    ["a title", "Test deck"],
  ])("finds the listing by %s", async (_how, listing) => {
    expect.assertions(1);
    const { client } = await unshareClient();
    const result = await client.callTool(unshare(listing));
    expect(result.structuredContent).toMatchObject({ listing: { id: LISTING_ID } });
    await client.close();
  });

  it("refuses a listing that is not the user's, and sends nothing to remove it", async () => {
    expect.assertions(3);
    const { client, posted } = await unshareClient();
    const result = await client.callTool(unshare("2183294427", true));
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(
      /No listing of yours on AnkiWeb has the id or name "2183294427"\. Your listings: 1606750520 \(Test deck\)/u,
    );
    expect(paths(posted)).toStrictEqual(["/svc/shared/list-mine"]);
    await client.close();
  });

  it("refuses an ambiguous title and lists the candidates", async () => {
    expect.assertions(2);
    const { client } = await unshareClient();
    const result = await client.callTool(unshare("Twin"));
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toContain('"Twin" matches 2 listings: 2 (Twin), 3 (Twin)');
    await client.close();
  });

  it("reports a listing AnkiWeb still lists after removing it", async () => {
    expect.assertions(2);
    const { client } = await unshareClient(true);
    const result = await client.callTool(unshare(String(LISTING_ID), true));
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/accepted the removal .* but still lists it/u);
    await client.close();
  });
});
