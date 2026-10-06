export class AuthRequiredError extends Error {
  override name = "AuthRequiredError";

  /** `importFailure` is why no session could be brought in from a local browser, when one was tried. */
  constructor(importFailure = "") {
    super(
      [
        "No signed-in AnkiWeb session.",
        importFailure,
        "Run `anki-web-mcp --login` in a terminal, sign in in the window it opens, then retry.",
      ]
        .filter((line) => line !== "")
        .join(" "),
    );
  }
}
