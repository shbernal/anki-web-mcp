import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { hasSessionCookie, readStoredSession } from "../browser/cookies.js";
import type { BrowserSession } from "../browser/session.js";
import { checkDataDir, type DataDir } from "../data-dir.js";
import { guarded } from "../errors.js";
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
      inputSchema: z.object({
        validate: z
          .boolean()
          .optional()
          .describe("Check the session against AnkiWeb. Starts a headless browser."),
      }),
      outputSchema: z.object({
        version: z.string(),
        dataDir: z.string(),
        sessionStored: z.boolean(),
        lastValidated: z.iso.datetime().optional(),
        authenticated: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guarded("server_status", async ({ validate }) => {
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
    }),
  );
}

export function registerCloseSession(server: McpServer, session: BrowserSession): void {
  server.registerTool(
    "close_session",
    {
      title: "Close the browser",
      description:
        "Close the server's headless browser to free its memory, once any call in progress has finished. The AnkiWeb session stays stored, and the next call that needs the browser starts it again. The browser also closes by itself after five idle minutes.",
      inputSchema: z.object({}),
      outputSchema: z.object({ closed: z.boolean().describe("false when no browser was open.") }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guarded("close_session", async () => {
      const closed = await session.release();
      return {
        content: [{ type: "text", text: closed ? "Browser closed." : "No browser was open." }],
        structuredContent: { closed },
      };
    }),
  );
}
