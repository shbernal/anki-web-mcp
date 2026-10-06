/*
 * The only module that imports Playwright's launcher, so swapping it for a
 * drop-in such as patchright is a change to this file alone.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { type BrowserContext, chromium } from "playwright";

export interface LaunchOptions {
  readonly profileDir: string;
  readonly downloadsDir: string;
  readonly headless: boolean;
  /** A Playwright channel such as `chrome`, to drive an installed browser instead. */
  readonly channel?: string | undefined;
}

export class BrowserMissingError extends Error {
  override name = "BrowserMissingError";
}

export async function launchContext(options: LaunchOptions): Promise<BrowserContext> {
  try {
    return await chromium.launchPersistentContext(options.profileDir, {
      headless: options.headless,
      acceptDownloads: true,
      downloadsPath: options.downloadsDir,
      ...(options.channel === undefined ? {} : { channel: options.channel }),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Executable doesn't exist")) {
      throw new BrowserMissingError(
        "Chromium is not installed. Run `anki-web-mcp --install-browser` (or `npx playwright install chromium`) and try again.",
        { cause: error },
      );
    }
    throw error;
  }
}

/** Runs the bundled Playwright CLI to download Chromium, and resolves to its exit code. */
export async function installBrowser(): Promise<number> {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
  const child = spawn(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" });
  // `once` rejects if the child emits `error` first, such as on a failed spawn.
  const exitArgs: unknown[] = await once(child, "exit");
  const [code] = exitArgs;
  return typeof code === "number" ? code : 1;
}
