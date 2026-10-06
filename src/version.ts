import { readFileSync } from "node:fs";

import { z } from "zod";

/*
 * Read at runtime rather than imported: `package.json` sits outside `rootDir`
 * for the build, and the relative URL resolves the same from `src/` and `dist/`.
 */
const manifest = readFileSync(new URL("../package.json", import.meta.url), "utf8");

export const { version } = z.object({ version: z.string() }).parse(JSON.parse(manifest));
