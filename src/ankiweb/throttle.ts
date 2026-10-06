import { setTimeout as sleep } from "node:timers/promises";

/** AnkiWeb is a small service run by one developer, so requests are spaced out. */
const DEFAULT_GAP_MS = 1000;
/** Playwright's request API waits this long by default, and `fetch` is held to the same. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Keeps a minimum gap between the requests sent through it. */
export class Throttle {
  #gapMs: number;
  #nextSlot = 0;

  constructor(gapMs: number) {
    this.#gapMs = gapMs;
  }

  setGap(ms: number): void {
    this.#gapMs = ms;
    this.#nextSlot = 0;
  }

  /**
   * Resolves once the gap has passed since the last request. Each caller
   * reserves its slot before waiting, so concurrent callers line up rather than
   * all going at once.
   */
  async wait(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.#nextSlot);
    this.#nextSlot = slot + this.#gapMs;
    if (slot > now) {
      await sleep(slot - now);
    }
  }
}

/** Every request this process sends to AnkiWeb, anonymous or signed in, goes through this one. */
export const ankiWebThrottle = new Throttle(DEFAULT_GAP_MS);
