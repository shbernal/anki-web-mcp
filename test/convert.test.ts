import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseMarkdown, toApkg } from "@ankimd/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SharedDecks } from "../src/ankiweb/shared.js";
import { ConvertError, convertApkg } from "../src/apkg-markdown.js";
import { resolveDataDir } from "../src/data-dir.js";
import { connectedClient, textOf } from "./connect.js";

const DECK = `## What does の mean?

Possessive.

## What is this?

![a dot](dot.png)

***

A dot.
`;
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47);

let scratch: string;
let apkg: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-"));
  const { deck } = parseMarkdown(DECK);
  const { data } = await toApkg(deck, {
    deckName: "Japanese Basics",
    resolveMedia: async () => ({ data: PNG, extension: ".png" }),
  });
  apkg = join(scratch, "Japanese_Basics.apkg");
  await writeFile(apkg, data);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("convertApkg", () => {
  it("writes the deck and its images into a folder named after the package", async () => {
    expect.assertions(6);
    const converted = await convertApkg(apkg);
    const folder = join(scratch, "Japanese_Basics");
    expect(converted).toMatchObject({
      directory: folder,
      markdownPath: join(folder, "Japanese_Basics.md"),
      title: "Japanese Basics",
      cards: 2,
      mediaFiles: 1,
    });
    const markdown = await readFile(converted.markdownPath, "utf8");
    expect(markdown).toContain("## What does の mean?");
    expect(markdown).toMatch(/^# Japanese Basics\n/u);
    const images = await readdir(join(folder, ".images"));
    const image = images.join(",");
    expect(markdown).toContain(`(.images/${image})`);
    const bytes = await readFile(join(folder, ".images", image));
    expect(bytes).toStrictEqual(Buffer.from(PNG));
    expect(converted.diagnostics).toStrictEqual([]);
  });

  it("numbers a second conversion rather than writing over the first", async () => {
    expect.assertions(1);
    await convertApkg(apkg);
    const second = await convertApkg(apkg, { directory: scratch, title: "Again" });
    expect(second.markdownPath).toBe(join(scratch, "Japanese_Basics (1)", "Japanese_Basics.md"));
  });

  it("refuses a relative path, another kind of file, and a missing one", async () => {
    expect.assertions(3);
    await expect(convertApkg("deck.apkg")).rejects.toThrow(/not an absolute path/u);
    await expect(convertApkg(join(scratch, "deck.md"))).rejects.toThrow(/not an \.apkg/u);
    await expect(convertApkg(join(scratch, "gone.apkg"))).rejects.toThrow(ConvertError);
  });
});

describe("convert_deck_to_markdown", () => {
  it("reports where the deck went and how many cards it holds", async () => {
    expect.assertions(2);
    const client = await connectedClient({
      dataDir: resolveDataDir(join(scratch, "data")),
      sharedDecks: new SharedDecks(),
    });
    const result = await client.callTool({
      name: "convert_deck_to_markdown",
      arguments: { path: apkg },
    });
    expect(result.structuredContent).toMatchObject({ cards: 2, diagnosticCount: 0 });
    expect(textOf(result.content)).toMatch(/^Wrote 2 cards and 1 media files to .*\.md\.$/u);
    await client.close();
  });
});
