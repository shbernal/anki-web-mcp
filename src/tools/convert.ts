import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { convertApkg, type ConvertedDeck } from "../apkg-markdown.js";
import { guarded } from "../errors.js";

/** Enough to say what was lost; a deck of cloze notes takes one line per reason anyway. */
const MAX_DIAGNOSTICS = 50;

const convertInput = z.object({
  path: z.string().describe("An absolute path to the .apkg."),
  directory: z
    .string()
    .optional()
    .describe(
      "An absolute path to an existing directory to create the deck's folder in. Defaults to the .apkg's own directory.",
    ),
  title: z
    .string()
    .optional()
    .describe("The deck's title. Defaults to the filename, with underscores as spaces."),
});

const convertDiagnostic = z.object({
  code: z.string(),
  card: z.number().int().optional().describe("0-based index of the card it concerns."),
  message: z.string(),
});

const convertOutput = z.object({
  directory: z.string(),
  markdownPath: z.string(),
  title: z.string(),
  cards: z.number().int(),
  mediaFiles: z.number().int(),
  diagnostics: z.array(convertDiagnostic),
  diagnosticCount: z.number().int(),
});

function convertResult(converted: Readonly<ConvertedDeck>) {
  const output: z.infer<typeof convertOutput> = {
    ...converted,
    diagnostics: converted.diagnostics
      .slice(0, MAX_DIAGNOSTICS)
      .map(({ code, cardIndex, message }) =>
        cardIndex === null ? { code, message } : { code, card: cardIndex, message },
      ),
    diagnosticCount: converted.diagnostics.length,
  };
  const text = [
    `Wrote ${converted.cards} cards and ${converted.mediaFiles} media files to ${converted.markdownPath}.`,
    ...output.diagnostics.map(({ message }) => `- ${message}`),
  ].join("\n");
  return { content: [{ type: "text" as const, text }], structuredContent: output };
}

export function registerConvert(server: McpServer): void {
  server.registerTool(
    "convert_deck_to_markdown",
    {
      title: "Convert a deck to Markdown",
      description:
        "Convert a local .apkg, such as one download_shared_deck saved, to a Flashcard Markdown file the assistant can read. It goes in a new folder named after the package, with the images its cards use under .images/; nothing existing is replaced. Only basic front-and-back notes convert: cloze and other note types are counted in `diagnostics`, and review history is not kept.",
      inputSchema: convertInput,
      outputSchema: convertOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    guarded("convert_deck_to_markdown", async ({ path, directory, title }) =>
      convertResult(await convertApkg(path, { directory, title })),
    ),
  );
}
