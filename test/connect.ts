import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { Cookie } from "playwright";
import { z } from "zod";

import type { PollOptions } from "../src/ankiweb/share.js";
import type { SharedDecks } from "../src/ankiweb/shared.js";
import { BrowserSession } from "../src/browser/session.js";
import type { DataDir } from "../src/data-dir.js";
import { createServer } from "../src/server.js";
import { fakeContext, type Respond } from "./fake-context.js";

const textContent = z.array(z.object({ text: z.string() }));

/** The text of a tool result's first content block. */
export function textOf(content: unknown): string | undefined {
  return textContent.parse(content)[0]?.text;
}

export interface ClientOptions {
  readonly dataDir: DataDir;
  readonly sharedDecks: SharedDecks;
  readonly loggedIn?: boolean;
  /** What the browser's cookie jar starts with. */
  readonly cookies?: readonly Readonly<Cookie>[];
  /** Answers what the browser posts through its request API. */
  readonly respond?: Respond;
  /** How long `share_deck` waits on AnkiWeb; tests poll without sleeping. */
  readonly sharePoll?: PollOptions;
}

/** A client connected to a server whose browser is a fake. */
export async function connectedClient({
  dataDir,
  sharedDecks,
  loggedIn = false,
  cookies = [],
  respond,
  sharePoll,
}: ClientOptions): Promise<Client> {
  const fake = fakeContext(cookies, respond);
  const session = new BrowserSession({
    dataDir,
    launch: async () => fake.context,
    checkLoggedIn: async () => loggedIn,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([
    createServer({
      dataDir,
      session,
      sharedDecks,
      ...(sharePoll === undefined ? {} : { sharePoll }),
    }).connect(serverSide),
    client.connect(clientSide),
  ]);
  return client;
}
