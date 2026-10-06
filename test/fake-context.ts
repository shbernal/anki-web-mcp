import type { BrowserContext, Cookie } from "playwright";

export interface FakeContext {
  readonly context: BrowserContext;
  readonly jar: Cookie[];
  readonly closed: () => boolean;
}

/** What a request sent through `context.request` gets back: a status and a body. */
export interface FakeReply {
  readonly status: number;
  readonly body: Uint8Array;
}

/**
 * The slice of a Playwright context the session touches, with no browser behind
 * it. `respond` answers what is posted through `context.request`.
 */
export function fakeContext(
  initial: readonly Readonly<Cookie>[] = [],
  respond: (url: string) => Promise<FakeReply> = async () => ({
    status: 404,
    body: new Uint8Array(),
  }),
): FakeContext {
  const jar = [...initial];
  const listeners: (() => void)[] = [];
  let isClosed = false;
  const fake = {
    cookies: async () => jar,
    addCookies: async (cookies: readonly Readonly<Cookie>[]) => {
      jar.push(...cookies);
    },
    clearCookies: async ({ domain }: { readonly domain: Readonly<RegExp> }) => {
      const kept = jar.filter((cookie) => !domain.test(cookie.domain));
      jar.splice(0, jar.length, ...kept);
    },
    on: (_event: "close", listener: () => void) => {
      listeners.push(listener);
    },
    request: {
      post: async (url: string) => {
        const { status, body } = await respond(url);
        return {
          status: () => status,
          ok: () => status >= 200 && status < 300,
          body: async () => Buffer.from(body),
          text: async () => new TextDecoder().decode(body),
        };
      },
    },
    close: async () => {
      isClosed = true;
      for (const listener of listeners) {
        listener();
      }
    },
  };
  return {
    context: fake as unknown as BrowserContext,
    jar,
    closed: () => isClosed,
  };
}
