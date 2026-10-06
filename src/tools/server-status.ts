import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { hasSessionCookie, readStoredSession } from "../browser/cookies.js";
import type { BrowserSession } from "../browser/session.js";
import { checkDataDir, type DataDir } from "../data-dir.js";
import { version } from "../version.js";

export function registerServerStatus(
  server: McpServer,
  dataDir: DataDir,
  session: BrowserSession,
): void {
  server.registerTool(
    "server_status",
    {
      title: "Server status",
      description:
        "Report the server version, the data directory, and whether an AnkiWeb session is stored. With `validate`, also start the browser and ask AnkiWeb whether that session is still signed in.",
      inputSchema: {
        validate: z
          .boolean()
          .optional()
          .describe("Check the session against AnkiWeb. Starts a headless browser."),
      },
      outputSchema: {
        version: z.string(),
        dataDir: z.string(),
        sessionStored: z.boolean(),
        lastValidated: z.iso.datetime().optional(),
        authenticated: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ validate }) => {
      const stored = (await checkDataDir(dataDir.root))
        ? await readStoredSession(dataDir.cookies)
        : undefined;
      const authenticated = validate === true ? await session.isAuthenticated() : undefined;
      // A validation that just succeeded rewrote the file, so read it again.
      const latest = authenticated === true ? await readStoredSession(dataDir.cookies) : stored;
      const lastValidated = latest?.validatedAt;
      const status = {
        version,
        dataDir: dataDir.root,
        sessionStored: latest !== undefined && hasSessionCookie(latest.cookies),
        ...(lastValidated === undefined ? {} : { lastValidated }),
        ...(authenticated === undefined ? {} : { authenticated }),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(status) }],
        structuredContent: status,
      };
    },
  );
}
