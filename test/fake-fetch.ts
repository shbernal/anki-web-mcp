import { readFile } from "node:fs/promises";

import type { Fetch } from "../src/ankiweb/response-cache.js";

export interface FakeFetch {
  readonly fetch: Fetch;
  /** Every URL requested, in order. */
  readonly urls: string[];
}

/** Answers each request from `respond`, with no network behind it. */
export function fakeFetch(respond: (url: string) => Promise<Response>): FakeFetch {
  const urls: string[] = [];
  const fake = async (url: string): Promise<Response> => {
    urls.push(url);
    return respond(url);
  };
  return { fetch: fake, urls };
}

/** A recorded AnkiWeb response body, sent with the `max-age` AnkiWeb sends. */
export async function fixtureResponse(name: string): Promise<Response> {
  const body = await readFile(new URL(`fixtures/ankiweb/${name}`, import.meta.url));
  return new Response(body, {
    headers: { "content-type": "application/octet-stream", "cache-control": "max-age=600" },
  });
}
