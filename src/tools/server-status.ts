import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { version } from "../version.js";

export function registerServerStatus(server: McpServer): void {
  server.registerTool(
    "server_status",
    {
      title: "Server status",
      description: "Report the server version and whether an AnkiWeb session is stored locally.",
      outputSchema: { sessionStored: z.boolean(), version: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => {
      const status = { sessionStored: false, version };
      return {
        content: [{ type: "text", text: JSON.stringify(status) }],
        structuredContent: status,
      };
    },
  );
}
