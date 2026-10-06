export class AuthRequiredError extends Error {
  override name = "AuthRequiredError";

  constructor() {
    super(
      "No signed-in AnkiWeb session. Run `anki-web-mcp --login` in a terminal, sign in in the window it opens, then retry.",
    );
  }
}
