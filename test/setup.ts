import { beforeAll } from "vitest";

import { ankiWebThrottle } from "../src/ankiweb/throttle.js";

// The fakes answer at once, so the second between AnkiWeb requests would only slow the suite.
beforeAll(() => {
  ankiWebThrottle.setGap(0);
});
