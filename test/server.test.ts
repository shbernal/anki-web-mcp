import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createServer } from "../src/server.js";
import { version } from "../src/version.js";

async function connectedClient(): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([createServer().connect(serverSide), client.connect(clientSide)]);
  return client;
}

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
    expect(result.structuredContent).toStrictEqual({ sessionStored: false, version });
    await client.close();
  });
});
