import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveDataDir } from "../src/data-dir.js";
import {
  downloadDirectory,
  DownloadError,
  isZipHead,
  numberedFilename,
  sanitizeFilename,
  saveApkg,
} from "../src/save-apkg.js";

const ZIP = Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00);

let scratch: string;

/** A body delivered in the chunks given, to exercise reads that split the zip header. */
function stream(...chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("sanitizeFilename", () => {
  it("keeps a plain name AnkiWeb suggests", () => {
    expect.assertions(1);
    expect(sanitizeFilename("Japanese_Basic_Hiragana.apkg", "1")).toBe(
      "Japanese_Basic_Hiragana.apkg",
    );
  });

  it("drops any directory part", () => {
    expect.assertions(2);
    expect(sanitizeFilename("../../etc/passwd", "1")).toBe("passwd.apkg");
    expect(sanitizeFilename(String.raw`..\..\deck.apkg`, "1")).toBe("deck.apkg");
  });

  it("replaces characters a filesystem refuses and trims edge dots", () => {
    expect.assertions(2);
    expect(sanitizeFilename('a<b>:c"d|e?f*g\u0000h.APKG', "1")).toBe("a_b_c_d_e_f_g_h.apkg");
    expect(sanitizeFilename("..hidden. ", "1")).toBe("hidden.apkg");
  });

  it("trims underscores from the edges and collapses runs of them", () => {
    expect.assertions(4);
    expect(sanitizeFilename("_Multivariable_Calculus.apkg", "1")).toBe(
      "Multivariable_Calculus.apkg",
    );
    expect(sanitizeFilename("Internal_Medicine_Boards_.apkg", "1")).toBe(
      "Internal_Medicine_Boards.apkg",
    );
    expect(sanitizeFilename("LatexMathJax_commands_and_symbols.apkg", "1")).toBe(
      "LatexMathJax_commands_and_symbols.apkg",
    );
    expect(sanitizeFilename("a__b___c.apkg", "1")).toBe("a_b_c.apkg");
  });

  it("falls back when nothing usable is left", () => {
    expect.assertions(4);
    expect(sanitizeFilename("___.apkg", "123")).toBe("123.apkg");
    expect(sanitizeFilename("..", "123")).toBe("123.apkg");
    expect(sanitizeFilename(undefined, "123")).toBe("123.apkg");
    expect(sanitizeFilename("", "")).toBe("deck.apkg");
  });

  it("renames Windows device names and caps the length", () => {
    expect.assertions(3);
    expect(sanitizeFilename("CON.apkg", "1")).toBe("_CON.apkg");
    expect(sanitizeFilename("_con_.apkg", "1")).toBe("_con.apkg");
    expect(sanitizeFilename("x".repeat(300), "1")).toHaveLength(125);
  });
});

describe("numberedFilename", () => {
  it("numbers copies before the extension", () => {
    expect.assertions(2);
    expect(numberedFilename("deck.apkg", 0)).toBe("deck.apkg");
    expect(numberedFilename("deck.apkg", 2)).toBe("deck (2).apkg");
  });
});

describe("isZipHead", () => {
  it("tells a zip from an HTML page and from a short body", () => {
    expect.assertions(3);
    expect(isZipHead(ZIP)).toBe(true);
    expect(isZipHead(new TextEncoder().encode("<!doctype html>"))).toBe(false);
    expect(isZipHead(Uint8Array.of(0x50, 0x4b))).toBe(false);
  });
});

describe("downloadDirectory", () => {
  it("defaults to the data dir's downloads, creating it", async () => {
    expect.assertions(2);
    const dataDir = resolveDataDir(join(scratch, "data"));
    await expect(downloadDirectory(undefined, dataDir)).resolves.toBe(dataDir.downloads);
    await expect(readdir(dataDir.downloads)).resolves.toStrictEqual([]);
  });

  it("accepts an existing absolute directory", async () => {
    expect.assertions(1);
    const dataDir = resolveDataDir(join(scratch, "data"));
    await expect(downloadDirectory(scratch, dataDir)).resolves.toBe(scratch);
  });

  it("refuses a relative path, a missing directory and a file", async () => {
    expect.assertions(3);
    const dataDir = resolveDataDir(join(scratch, "data"));
    const file = join(scratch, "file");
    await writeFile(file, "");
    await expect(downloadDirectory("decks", dataDir)).rejects.toThrow(/not an absolute path/u);
    await expect(downloadDirectory(join(scratch, "missing"), dataDir)).rejects.toThrow(
      DownloadError,
    );
    await expect(downloadDirectory(file, dataDir)).rejects.toThrow(/not an existing directory/u);
  });
});

describe("saveApkg", () => {
  it("writes a body whose zip header arrives split across chunks", async () => {
    expect.assertions(2);
    const saved = await saveApkg(scratch, "deck.apkg", stream(ZIP.subarray(0, 2), ZIP.subarray(2)));
    expect(saved).toStrictEqual({
      path: join(scratch, "deck.apkg"),
      filename: "deck.apkg",
      bytes: 6,
    });
    await expect(readFile(saved.path)).resolves.toStrictEqual(Buffer.from(ZIP));
  });

  it("never replaces an existing file", async () => {
    expect.assertions(2);
    await writeFile(join(scratch, "deck.apkg"), "mine");
    await writeFile(join(scratch, "deck (1).apkg"), "mine too");
    const saved = await saveApkg(scratch, "deck.apkg", stream(ZIP));
    expect(saved.filename).toBe("deck (2).apkg");
    await expect(readFile(join(scratch, "deck.apkg"), "utf8")).resolves.toBe("mine");
  });

  it("refuses a body that is not a zip and writes nothing", async () => {
    expect.assertions(2);
    const html = new TextEncoder().encode("<!doctype html><html>");
    await expect(saveApkg(scratch, "deck.apkg", stream(html))).rejects.toThrow(
      /something other than a deck, starting "<!doctype html><"/u,
    );
    await expect(readdir(scratch)).resolves.toStrictEqual([]);
  });

  it("removes the file when the transfer fails part way", async () => {
    expect.assertions(2);
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(ZIP);
      },
      pull(controller) {
        controller.error(new Error("connection reset"));
      },
    });
    await expect(saveApkg(scratch, "deck.apkg", failing)).rejects.toThrow("connection reset");
    await expect(readdir(scratch)).resolves.toStrictEqual([]);
  });
});
