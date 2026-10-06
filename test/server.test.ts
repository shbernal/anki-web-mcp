import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeStoredSession } from "../src/browser/cookies.js";
import { BrowserSession } from "../src/browser/session.js";
import { type DataDir, ensureDataDir, resolveDataDir } from "../src/data-dir.js";
import { createServer } from "../src/server.js";
import { version } from "../src/version.js";
import { fakeContext } from "./fake-context.js";

const VALIDATED_AT = "2026-10-06T12:00:00.000Z";

let scratch: string;
let dataDir: DataDir;

async function connectedClient(): Promise<Client> {
  const fake = fakeContext();
  const session = new BrowserSession({
    dataDir,
    launch: async () => fake.context,
    checkLoggedIn: async () => false,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([
    createServer({ dataDir, session }).connect(serverSide),
    client.connect(clientSide),
  ]);
  return client;
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-"));
  dataDir = resolveDataDir(join(scratch, "data"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("server", () => {
  it("lists server_status", async () => {
    expect.assertions(1);
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools).toMatchObject([{ name: "server_status" }]);
    await client.close();
  });

  it("reports the package version and no stored session", async () => {
    expect.assertions(1);
    const client = await connectedClient();
    const result = await client.callTool({ name: "server_status" });
    expect(result.structuredContent).toStrictEqual({
      version,
      dataDir: dataDir.root,
      sessionStored: false,
    });
    await client.close();
  });

  it("reports a stored session and when it was last validated", async () => {
    expect.assertions(1);
    await ensureDataDir(dataDir);
    await writeStoredSession(dataDir.cookies, {
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
      sessionStored: true,
      lastValidated: VALIDATED_AT,
      authenticated: false,
    });
    await client.close();
  });
});
