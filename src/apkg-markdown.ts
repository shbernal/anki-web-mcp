import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

import { type Diagnostic, diagnostic, readDeck, relocateImages } from "@ankimd/core";

import { unlessMissing } from "./data-dir.js";
import { ToolError } from "./errors.js";
import { sanitizeFilename } from "./save-apkg.js";

const APKG = ".apkg";
/** Where a Flashcard Markdown deck keeps its images, beside the `.md`. */
const MEDIA_DIR = ".images";
/** A directory that already holds this many conversions of one deck is a sign of a loop. */
const MAX_COPIES = 1000;

export class ConvertError extends ToolError {
  override name = "ConvertError";
}

export interface ConvertedDeck {
  /** The folder made for this deck, holding the `.md` and its `.images/`. */
  readonly directory: string;
  readonly markdownPath: string;
  readonly title: string;
  readonly cards: number;
  readonly mediaFiles: number;
  /** What could not be carried over, such as cloze notes, which the format has no syntax for. */
  readonly diagnostics: readonly Diagnostic[];
}

async function requireFile(path: string): Promise<void> {
  if (!isAbsolute(path)) {
    throw new ConvertError(`${path} is not an absolute path`);
  }
  if (extname(path).toLowerCase() !== APKG) {
    throw new ConvertError(`${path} is not an .apkg file`);
  }
  const stats = await unlessMissing(stat(path));
  if (stats?.isFile() !== true) {
    throw new ConvertError(`${path} does not exist`);
  }
}

async function requireDirectory(path: string): Promise<void> {
  if (!isAbsolute(path)) {
    throw new ConvertError(`${path} is not an absolute path`);
  }
  const stats = await unlessMissing(stat(path));
  if (stats?.isDirectory() !== true) {
    throw new ConvertError(`${path} is not an existing directory`);
  }
}

/** Creates `parent/stem`, or `stem (1)`, `stem (2)` and so on, never reusing one. */
async function createFolder(parent: string, stem: string): Promise<string> {
  for (let copy = 0; copy < MAX_COPIES; copy += 1) {
    const path = join(parent, copy === 0 ? stem : `${stem} (${copy})`);
    try {
      await mkdir(path);
      return path;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
    }
  }
  throw new ConvertError(`${parent} already holds ${MAX_COPIES} conversions of ${stem}`);
}

/**
 * Whether a media name from the package stays inside `directory`. The name is
 * whatever the `.apkg` says, and a deck from AnkiWeb is a stranger's file, so
 * `../../.bashrc` is refused rather than written.
 */
function staysInside(directory: string, name: string): boolean {
  const inside = relative(directory, resolve(directory, name));
  return inside !== "" && !inside.startsWith("..") && !isAbsolute(inside);
}

/** Writes what stays inside `directory`, and returns the names written. */
async function writeMedia(
  directory: string,
  media: ReadonlyMap<string, Uint8Array>,
): Promise<string[]> {
  const names = [...media.keys()].filter((name) => staysInside(directory, name));
  if (names.length === 0) {
    return names;
  }
  await mkdir(directory);
  for (const name of names) {
    const target = join(directory, name);
    // A name such as `audio/a.mp3` needs its own folder.
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, media.get(name) ?? new Uint8Array(), { flag: "wx" });
  }
  return names;
}

function refusedMedia(names: readonly string[]): Diagnostic[] {
  return names.map((name) =>
    diagnostic(
      "unrepresentable-content",
      `the media file "${name}" is named outside the deck's folder and was not written; its reference stays as written`,
    ),
  );
}

export interface ConvertOptions {
  /** Where the deck's folder goes; beside the package when left out. */
  readonly directory?: string | undefined;
  /** The deck's title; the package's filename, with AnkiWeb's underscores as spaces, by default. */
  readonly title?: string | undefined;
}

/**
 * Converts an `.apkg` to Flashcard Markdown in a new folder named after it,
 * with the images its cards use under `.images/`. Nothing existing is
 * replaced. Scheduling is not carried over, and notes the format cannot hold
 * are counted in the diagnostics rather than dropped silently.
 */
export async function convertApkg(
  source: string,
  options: ConvertOptions = {},
): Promise<ConvertedDeck> {
  await requireFile(source);
  const parent = options.directory ?? dirname(source);
  await requireDirectory(parent);
  const stem = sanitizeFilename(basename(source), "deck").slice(0, -APKG.length);
  const title = options.title ?? stem.replaceAll("_", " ");
  const { deck, diagnostics, markdown, media } = await readDeck(await readFile(source), { title });
  const folder = await createFolder(parent, stem);
  const mediaDir = join(folder, MEDIA_DIR);
  const written = await writeMedia(mediaDir, media);
  const moves = new Map(written.map((name) => [name, `${MEDIA_DIR}/${name}`] as const));
  const markdownPath = join(folder, `${stem}.md`);
  await writeFile(markdownPath, relocateImages(markdown, moves), { flag: "wx" });
  return {
    directory: folder,
    markdownPath,
    title,
    cards: deck.cards.length,
    mediaFiles: written.length,
    diagnostics: [
      ...diagnostics,
      ...refusedMedia([...media.keys()].filter((name) => !written.includes(name))),
    ],
  };
}
