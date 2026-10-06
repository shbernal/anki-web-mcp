import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { hasSessionCookie, readStoredSession } from "../browser/cookies.js";
import type { BrowserSession } from "../browser/session.js";
import { checkDataDir, type DataDir } from "../data-dir.js";
import { guarded } from "../errors.js";
import { version } from "../version.js";

const STATUS = z.object({
  version: z.string(),
  dataDir: z.string().describe("Where the session is kept."),
  downloadsDir: z.string().describe("Where downloads go when no directory is given."),
  sessionStored: z.boolean(),
  lastValidated: z.iso.datetime().optional(),
  authenticated: z.boolean().optional(),
});

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
        "Report the server version, where the session and downloads are kept, and whether an AnkiWeb session is stored. With `validate`, also ask AnkiWeb whether that session is still signed in.",
      inputSchema: z.object({
        validate: z
          .boolean()
          .optional()
          .describe(
            "Check the session against AnkiWeb. Starts a headless browser only when the stored cookie is missing or turned down.",
          ),
      }),
      outputSchema: STATUS,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guarded("server_status", async ({ validate }) => {
      const { account } = session;
      const stored = (await checkDataDir(account.dir))
        ? await readStoredSession(account.cookies)
        : undefined;
      const authenticated = validate === true ? await session.checkSignedIn() : undefined;
      // A validation that just succeeded rewrote the file, so read it again.
      const latest = authenticated === true ? await readStoredSession(account.cookies) : stored;
      const lastValidated = latest?.validatedAt;
      const status = {
        version,
        dataDir: dataDir.root,
        downloadsDir: dataDir.downloads,
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
