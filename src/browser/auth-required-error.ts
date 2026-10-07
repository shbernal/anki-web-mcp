import { DEFAULT_ACCOUNT, loginCommand } from "../data-dir.js";
import { ToolError } from "../errors.js";

export class AuthRequiredError extends ToolError {
  override name = "AuthRequiredError";
  /** Why no session could be brought in from a local browser, when one was tried. */
  readonly importFailure: string;

  /** `account` names the session that is missing, in the sign-in command the message gives. */
  constructor(importFailure = "", account = DEFAULT_ACCOUNT) {
    super(
      [
        "No signed-in AnkiWeb session.",
        importFailure,
        `Run \`${loginCommand(account)}\` in a terminal, sign in in the window it opens, then retry.`,
      ]
        .filter((line) => line !== "")
        .join(" "),
    );
    this.importFailure = importFailure;
  }
}
