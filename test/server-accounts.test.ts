import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { BrowserContext, Cookie } from "playwright";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { encodeMessage } from "../src/ankiweb/protobuf.js";
import { SharedDecks } from "../src/ankiweb/shared.js";
import { Accounts } from "../src/browser/accounts.js";
import { writeStoredSession } from "../src/browser/cookies.js";
import {
  accountPaths,
  type DataDir,
  DEFAULT_ACCOUNT,
  ensureAccount,
  resolveDataDir,
} from "../src/data-dir.js";
import { createServer } from "../src/server.js";
import { textOf } from "./connect.js";
import { type FakeContext, fakeContext, type FakeReply } from "./fake-context.js";

const SESSION: Cookie = {
  name: "ankiweb",
  value: "token",
  domain: "ankiweb.net",
  path: "/",
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
};

/** A deck list holding one deck, named after the account it belongs to. */
function deckList(name: string): Uint8Array {
  const deck = encodeMessage([
    [1, 7n],
    [2, `${name} deck`],
    [4, 1],
  ]);
  return encodeMessage([
    [1, encodeMessage([[3, deck]])],
    [2, 1],
  ]);
}

/** A list of one shared listing, titled after the account it belongs to. */
function sharedList(name: string): Uint8Array {
  return encodeMessage([
    [
      1,
      encodeMessage([
        [1, 9],
        [2, `${name} listing`],
      ]),
    ],
  ]);
}

interface Fake {
  readonly fake: FakeContext;
  launches: number;
  signedIn: boolean;
}

/** `get-account-status` with `logged_in` set; AnkiWeb sends an empty body signed out. */
const LOGGED_IN = Uint8Array.of(0x08, 0x01);

let scratch: string;
let dataDir: DataDir;
let fakes: Map<string, Fake>;
/** The account whose deck list waits for `gates` to dispatch `release`. */
let held: string | undefined;
const gates = new EventTarget();

function fakeFor(name: string): Fake {
  const entry: Fake = {
    launches: 0,
    signedIn: true,
    fake: fakeContext([SESSION], async (url): Promise<FakeReply> => {
      if (url.endsWith("/get-account-status")) {
        return { status: 200, body: entry.signedIn ? LOGGED_IN : new Uint8Array() };
      }
      if (url.endsWith("/deck-list-info")) {
        if (name === held) {
          await once(gates, "release");
        }
        return { status: 200, body: deckList(name) };
      }
      if (url.endsWith("/list-mine")) {
        return { status: 200, body: sharedList(name) };
      }
      return { status: 200, body: new Uint8Array() };
    }),
  };
  return entry;
}

/** Stores a session for each name, so each is listed, with a fake browser behind it. */
async function store(...names: readonly string[]): Promise<void> {
  for (const name of names) {
    const account = accountPaths(dataDir, name);
    await ensureAccount(dataDir, account);
    await writeStoredSession(account.cookies, {
      validatedAt: "2026-10-06T12:00:00.000Z",
      cookies: [SESSION],
    });
    fakes.set(name, fakeFor(name));
  }
}

function launchFor(profileDir: string): BrowserContext {
  for (const [name, entry] of fakes) {
    if (accountPaths(dataDir, name).profile === profileDir) {
      entry.launches += 1;
      return entry.fake.context;
    }
  }
  throw new Error(`No fake browser for ${profileDir}`);
}

/** Signed in for every account but `signedOut`. */
async function connect(signedOut: readonly string[] = []): Promise<Client> {
  for (const name of signedOut) {
    const entry = fakes.get(name);
    if (entry !== undefined) {
      entry.signedIn = false;
    }
  }
  const accounts = new Accounts({
    dataDir,
    session: {
      launch: async ({ profileDir }) => launchFor(profileDir),
      fetch: async () => new Response(new Uint8Array()),
    },
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([
    createServer({ accounts, sharedDecks: new SharedDecks() }).connect(serverSide),
    client.connect(clientSide),
  ]);
  return client;
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-"));
  dataDir = resolveDataDir(join(scratch, "data"));
  fakes = new Map();
  held = undefined;
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

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
    held = DEFAULT_ACCOUNT;
    const client = await connect();
    const slow = client.callTool({ name: "list_my_decks" });
    const fast = await client.callTool({ name: "list_my_decks", arguments: { account: "second" } });
    expect(textOf(fast.content)).toContain("second deck");
    gates.dispatchEvent(new Event("release"));
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
    expect(fakes.get(DEFAULT_ACCOUNT)?.fake.closed()).toBe(false);
    const all = await client.callTool({ name: "close_session" });
    expect(all.structuredContent).toStrictEqual({ closed: true });
    expect(fakes.get(DEFAULT_ACCOUNT)?.fake.closed()).toBe(true);
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
    expect(fakes.get(DEFAULT_ACCOUNT)?.launches).toBe(0);
    await client.close();
  });
});

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
