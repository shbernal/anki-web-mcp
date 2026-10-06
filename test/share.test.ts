import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decodeMessage, encodeMessage, readBool, readString } from "../src/ankiweb/protobuf.js";
import { SharedDecks } from "../src/ankiweb/shared.js";
import { type DataDir, resolveDataDir } from "../src/data-dir.js";
import { connectedClient, textOf } from "./connect.js";
import type { FakeReply } from "./fake-context.js";
import { nested } from "./nested.js";

const DECK_ID = 1_791_280_883_007;
const LISTING = { title: "Test deck", description: "Made for a test." };

let scratch: string;
let dataDir: DataDir;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-"));
  dataDir = resolveDataDir(join(scratch, "data"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function deckNode(id: number, name: string): Uint8Array {
  return encodeMessage([
    [1, BigInt(id)],
    [2, name],
    [4, 1],
  ]);
}

/** A deck list with the Default deck, one deck to share, and two sharing a name. */
const DECK_LIST = encodeMessage([
  [
    1,
    encodeMessage([
      [3, deckNode(1, "Default")],
      [3, deckNode(DECK_ID, "Test deck")],
      [3, deckNode(2, "Twin")],
      [3, deckNode(3, "Twin")],
    ]),
  ],
  [2, 1],
]);

interface Posted {
  readonly url: string;
  readonly body: Uint8Array;
}

interface AnkiWebOptions {
  /** The `deck-share-info` response body. */
  readonly shareInfo?: Uint8Array;
  /** Successive `deck-share-state` answers; the last one repeats. */
  readonly states?: readonly Uint8Array[];
}

/** Answers the deck and share endpoints, and records what was posted. */
function ankiWeb({ shareInfo = new Uint8Array(), states = [] }: AnkiWebOptions = {}): {
  readonly posted: Posted[];
  readonly respond: (url: string, body: Uint8Array) => Promise<FakeReply>;
} {
  const posted: Posted[] = [];
  let polls = 0;
  const respond = async (url: string, body: Uint8Array): Promise<FakeReply> => {
    posted.push({ url, body });
    const path = new URL(url).pathname;
    if (path.endsWith("/deck-list-info")) {
      return { status: 200, body: DECK_LIST };
    }
    if (path.endsWith("/deck-share-info")) {
      return { status: 200, body: shareInfo };
    }
    if (path.endsWith("/deck-share-state")) {
      polls += 1;
      return { status: 200, body: states[Math.min(polls, states.length) - 1] ?? new Uint8Array() };
    }
    return { status: 200, body: new Uint8Array() };
  };
  return { posted, respond };
}

/** No share in flight: protobuf leaves out a zero state. */
const NONE = new Uint8Array();

function state(value: number, sharedId?: number): Uint8Array {
  return encodeMessage([
    [1, value],
    [2, sharedId],
  ]);
}

function submitted(posted: readonly Posted[]): Posted[] {
  return posted.filter(({ url }) => url.endsWith("/svc/decks/deck-share"));
}

function onlyBody(posted: readonly Posted[]): Uint8Array {
  const [only] = posted;
  if (only === undefined || posted.length > 1) {
    throw new Error(`Expected one request, got ${posted.length}`);
  }
  return only.body;
}

async function shareClient(options: AnkiWebOptions = {}): Promise<{
  readonly client: Awaited<ReturnType<typeof connectedClient>>;
  readonly posted: Posted[];
}> {
  const { posted, respond } = ankiWeb(options);
  const client = await connectedClient({
    dataDir,
    sharedDecks: new SharedDecks(),
    loggedIn: true,
    respond,
    sharePoll: { intervalMs: 0, timeoutMs: 1000 },
  });
  return { client, posted };
}

function share(args: Readonly<Record<string, unknown>>): {
  name: string;
  arguments: Record<string, unknown>;
} {
  return {
    name: "share_deck",
    arguments: {
      deck: "Test deck",
      title: LISTING.title,
      description: LISTING.description,
      tags: ["test", "sample"],
      ...args,
    },
  };
}

describe("share_deck", () => {
  it("previews without submitting", async () => {
    expect.assertions(4);
    const { client, posted } = await shareClient();
    const result = await client.callTool(share({}));
    expect(result.structuredContent).toMatchObject({
      status: "preview",
      deck: { id: DECK_ID, name: "Test deck" },
      title: LISTING.title,
      tags: ["test", "sample"],
      problems: [],
    });
    expect(textOf(result.content)).toMatch(/^Preview only: nothing was published\./u);
    expect(submitted(posted)).toStrictEqual([]);
    expect(posted.map(({ url }) => new URL(url).pathname)).toStrictEqual([
      "/svc/decks/deck-list-info",
      "/svc/decks/deck-share-info",
    ]);
    await client.close();
  });

  it("previews what is missing", async () => {
    expect.assertions(1);
    const { client } = await shareClient();
    const result = await client.callTool(share({ description: undefined }));
    expect(result.structuredContent).toMatchObject({ problems: ["A description is required."] });
    await client.close();
  });

  it("publishes on confirm and waits for the listing", async () => {
    expect.assertions(3);
    const { client, posted } = await shareClient({
      states: [NONE, state(1), state(2), state(3, 42)],
    });
    const result = await client.callTool(share({ confirm: true }));
    expect(result.structuredContent).toMatchObject({
      status: "shared",
      sharedId: 42,
      url: "https://ankiweb.net/shared/info/42",
    });
    const request = decodeMessage(onlyBody(submitted(posted)));
    expect(readString(nested(request, 1), 2)).toBe("test sample");
    expect(readBool(request, 2)).toBe(true);
    await client.close();
  });

  it("waits past the outcome a previous share left behind", async () => {
    expect.assertions(1);
    const { client } = await shareClient({ states: [state(3, 7), state(3, 7), state(3, 42)] });
    const result = await client.callTool(share({ confirm: true }));
    expect(result.structuredContent).toMatchObject({ status: "shared", sharedId: 42 });
    await client.close();
  });

  it("reports a share still processing as pending", async () => {
    expect.assertions(2);
    const { posted, respond } = ankiWeb({ states: [NONE, state(1)] });
    const client = await connectedClient({
      dataDir,
      sharedDecks: new SharedDecks(),
      loggedIn: true,
      respond,
      sharePoll: { intervalMs: 0, timeoutMs: 0 },
    });
    const result = await client.callTool(share({ confirm: true }));
    expect(result.structuredContent).toMatchObject({ status: "pending" });
    expect(submitted(posted)).toHaveLength(1);
    await client.close();
  });

  it("refuses to publish what the preview flags", async () => {
    expect.assertions(3);
    const { client, posted } = await shareClient();
    const result = await client.callTool(share({ title: " ", confirm: true }));
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/Nothing was published\. A title is required\./u);
    expect(submitted(posted)).toStrictEqual([]);
    await client.close();
  });

  it("says when AnkiWeb refuses a deck as too large", async () => {
    expect.assertions(2);
    const { client } = await shareClient({ states: [NONE, state(4)] });
    const result = await client.callTool(share({ confirm: true }));
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/too large/u);
    await client.close();
  });

  it("refuses an ambiguous name and lists the candidates", async () => {
    expect.assertions(2);
    const { client } = await shareClient();
    const result = await client.callTool(share({ deck: "Twin" }));
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(/matches 2 decks: 2 \(Twin\), 3 \(Twin\)/u);
    await client.close();
  });

  it("accepts a deck id", async () => {
    expect.assertions(1);
    const { client } = await shareClient();
    const result = await client.callTool(share({ deck: "3" }));
    expect(result.structuredContent).toMatchObject({ deck: { id: 3, name: "Twin" } });
    await client.close();
  });

  it("refuses the Default deck", async () => {
    expect.assertions(1);
    const { client } = await shareClient();
    const result = await client.callTool(share({ deck: "Default" }));
    expect(textOf(result.content)).toMatch(/does not share the Default deck/u);
    await client.close();
  });

  it("stops at a deck that is already shared", async () => {
    expect.assertions(3);
    const shareInfo = encodeMessage([[1, encodeMessage([[6, 77]])]]);
    const { client, posted } = await shareClient({ shareInfo });
    const result = await client.callTool(share({ confirm: true }));
    expect(result.isError).toBe(true);
    expect(textOf(result.content)).toMatch(
      /already shared as https:\/\/ankiweb\.net\/shared\/info\/77/u,
    );
    expect(submitted(posted)).toStrictEqual([]);
    await client.close();
  });
});
