import type { BrowserContext, Cookie } from "playwright";

export interface FakeContext {
  readonly context: BrowserContext;
  readonly jar: Cookie[];
  readonly closed: () => boolean;
}

/** The slice of a Playwright context the session touches, with no browser behind it. */
export function fakeContext(initial: readonly Readonly<Cookie>[] = []): FakeContext {
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
