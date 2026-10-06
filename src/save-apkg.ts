import { type FileHandle, open, rm, stat } from "node:fs/promises";
import { extname, isAbsolute, join } from "node:path";

import { type DataDir, ensureDataDir, unlessMissing } from "./data-dir.js";

const APKG = ".apkg";
/** Every `.apkg` is a zip, and a zip opens with a local file header. */
const ZIP_MAGIC = new TextEncoder().encode("PK\u0003\u0004");
/** Well under the 255 bytes most filesystems allow, leaving room for ` (n)`. */
const MAX_STEM_LENGTH = 120;
/** A directory that already holds this many copies of one deck is a sign of a loop. */
const MAX_COPIES = 1000;
/** Characters Windows forbids in a filename, plus every control character. */
// oxlint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /[\u0000-\u001F\u007F<>:"/\\|?*]/gu;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com\d|lpt\d)$/iu;
const EDGE_DOTS_AND_SPACES = /^[\s.]+|[\s.]+$/gu;
const HEAD_PREVIEW = 16;

export class DownloadError extends Error {
  override name = "DownloadError";
}

export interface SavedFile {
  readonly path: string;
  readonly filename: string;
  readonly bytes: number;
}

/**
 * Turns a name a server suggested into a plain basename ending in `.apkg`, or
 * `fallback` when nothing usable is left. Any directory part is dropped, so the
 * result can never point outside the directory it is joined to.
 */
export function sanitizeFilename(suggested: string | undefined, fallback: string): string {
  const base = (suggested ?? "").split(/[/\\]/u).at(-1) ?? "";
  const named = extname(base).toLowerCase() === APKG ? base.slice(0, -APKG.length) : base;
  const stem = named
    .replaceAll(UNSAFE_CHARACTERS, "_")
    .slice(0, MAX_STEM_LENGTH)
    .replaceAll(EDGE_DOTS_AND_SPACES, "");
  if (stem === "") {
    return fallback === "" ? `deck${APKG}` : sanitizeFilename(fallback, "");
  }
  return `${WINDOWS_RESERVED.test(stem) ? `_${stem}` : stem}${APKG}`;
}

/** `name.apkg`, then `name (1).apkg`, `name (2).apkg` and so on. */
export function numberedFilename(filename: string, copy: number): string {
  if (copy === 0) {
    return filename;
  }
  const extension = extname(filename);
  return `${filename.slice(0, filename.length - extension.length)} (${copy})${extension}`;
}

export function isZipHead(head: Readonly<Uint8Array>): boolean {
  return ZIP_MAGIC.every((byte, index) => head[index] === byte);
}

/**
 * Where a download goes: the data dir's `downloads/` unless the caller names a
 * directory, which has to be an absolute path to one that already exists.
 */
export async function downloadDirectory(
  requested: string | undefined,
  dataDir: DataDir,
): Promise<string> {
  if (requested === undefined) {
    await ensureDataDir(dataDir);
    return dataDir.downloads;
  }
  if (!isAbsolute(requested)) {
    throw new DownloadError(`${requested} is not an absolute path`);
  }
  const stats = await unlessMissing(stat(requested));
  if (stats?.isDirectory() !== true) {
    throw new DownloadError(`${requested} is not an existing directory`);
  }
  return requested;
}

/** Creates the first free numbered variant of `filename`, never replacing a file. */
async function createExclusive(
  directory: string,
  filename: string,
): Promise<{ handle: FileHandle; path: string; filename: string }> {
  for (let copy = 0; copy < MAX_COPIES; copy += 1) {
    const candidate = numberedFilename(filename, copy);
    const path = join(directory, candidate);
    try {
      return { handle: await open(path, "wx"), path, filename: candidate };
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
    }
  }
  throw new DownloadError(`${directory} already holds ${MAX_COPIES} copies of ${filename}`);
}

/** Reads chunks until there are enough bytes to tell a zip from anything else. */
async function readHead(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (length < ZIP_MAGIC.length) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    length += value.length;
  }
  return chunks;
}

async function writeAll(
  handle: FileHandle,
  head: readonly Uint8Array[],
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<number> {
  let bytes = 0;
  for (const chunk of head) {
    await handle.write(chunk);
    bytes += chunk.length;
  }
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    await handle.write(next.value);
    bytes += next.value.length;
  }
  return bytes;
}

/** Like `writeAll`, into a file that is removed again if the transfer fails. */
async function writeOrRemove(
  target: Readonly<{ handle: FileHandle; path: string }>,
  head: readonly Uint8Array[],
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<number> {
  try {
    return await writeAll(target.handle, head, reader);
  } catch (error) {
    await rm(target.path, { force: true });
    throw error;
  } finally {
    await target.handle.close();
  }
}

/**
 * Streams `body` into a new file in `directory`. Nothing is written unless the
 * body opens like a zip, and a transfer that fails part way leaves no file.
 */
export async function saveApkg(
  directory: string,
  filename: string,
  body: ReadableStream<Uint8Array>,
): Promise<SavedFile> {
  const reader = body.getReader();
  const head = await readHead(reader);
  const first = Buffer.concat(head);
  if (!isZipHead(first)) {
    await reader.cancel();
    const preview = new TextDecoder().decode(first.subarray(0, HEAD_PREVIEW));
    throw new DownloadError(
      `AnkiWeb sent something other than a deck, starting ${JSON.stringify(preview)}`,
    );
  }
  const target = await createExclusive(directory, filename);
  const bytes = await writeOrRemove(target, head, reader);
  return { path: target.path, filename: target.filename, bytes };
}
