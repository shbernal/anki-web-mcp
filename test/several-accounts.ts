import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { BrowserContext, Cookie } from "playwright";

import { encodeMessage } from "../src/ankiweb/protobuf.js";
import { SharedDecks } from "../src/ankiweb/shared.js";
import { Accounts } from "../src/browser/accounts.js";
import { writeStoredSession } from "../src/browser/cookies.js";
import { accountPaths, type DataDir, ensureAccount, resolveDataDir } from "../src/data-dir.js";
import { createServer } from "../src/server.js";
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

export interface Fake {
  readonly fake: FakeContext;
  launches: number;
  signedIn: boolean;
}

/** `get-account-status` with `logged_in` set; AnkiWeb sends an empty body signed out. */
const LOGGED_IN = Uint8Array.of(0x08, 0x01);

let scratch: string;
let dataDir: DataDir;
const fakes = new Map<string, Fake>();
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
export async function store(...names: readonly string[]): Promise<void> {
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
export async function connect(signedOut: readonly string[] = []): Promise<Client> {
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

/** The fake browser behind `name`'s session, once `store` has made it. */
export function fakeOf(name: string): Fake | undefined {
  return fakes.get(name);
}

/** Holds `name`'s deck list until `release`. */
export function hold(name: string): void {
  held = name;
}

export function release(): void {
  gates.dispatchEvent(new Event("release"));
}

/** A fresh data dir with no account stored, for a `beforeEach`. */
export async function setUp(): Promise<void> {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-"));
  dataDir = resolveDataDir(join(scratch, "data"));
  fakes.clear();
  held = undefined;
}

/** Removes what `setUp` made, for an `afterEach`. */
export async function tearDown(): Promise<void> {
  await rm(scratch, { recursive: true, force: true });
}
