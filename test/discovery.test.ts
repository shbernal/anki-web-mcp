import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverProfiles } from "../src/import/discovery.js";
import { LINUX } from "./chromium-cookies.js";

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anki-web-mcp-discovery-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function touch(...segments: readonly string[]): Promise<void> {
  const path = join(scratch, ...segments);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "");
}

describe("profile discovery", () => {
  it("finds every channel and profile, under Network/ or not", async () => {
    expect.assertions(1);
    await touch("config", "google-chrome", "Default", "Network", "Cookies");
    await touch("config", "google-chrome", "Profile 2", "Cookies");
    await touch("config", "google-chrome", "System Profile", "Cookies");
    await touch("config", "google-chrome-beta", "Default", "Cookies");
    await touch("config", "google-chrome-notes.txt");
    await touch("config", "opera", "Cookies");
    const profiles = await discoverProfiles(undefined, {
      platform: "linux",
      home: scratch,
      env: { XDG_CONFIG_HOME: join(scratch, "config") },
    });
    expect(profiles.map(({ label, keystore }) => [label, keystore])).toStrictEqual([
      ["Google Chrome / Default", LINUX],
      ["Google Chrome / Profile 2", LINUX],
      ["Google Chrome / Default", LINUX],
      ["Opera / opera", { os: "linux", application: "opera", kwallet: "Chromium" }],
    ]);
  });

  it("looks under Application Support on macOS, for one browser when named", async () => {
    expect.assertions(1);
    await touch("Library", "Application Support", "Arc", "User Data", "Default", "Cookies");
    await touch("Library", "Application Support", "Google", "Chrome", "Default", "Cookies");
    const profiles = await discoverProfiles("arc", { platform: "darwin", home: scratch, env: {} });
    expect(profiles.map(({ label, keystore }) => [label, keystore])).toStrictEqual([
      ["Arc / Default", { os: "darwin", service: "Arc Safe Storage", account: "Arc" }],
    ]);
  });
});
