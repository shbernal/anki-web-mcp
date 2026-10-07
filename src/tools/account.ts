import { z } from "zod";

/** The `account` every tool that needs a session takes. */
export const accountInput = z
  .string()
  .optional()
  .describe(
    "Omit unless the user names an AnkiWeb account. Which of the accounts signed in on this machine to act as; a name that is not one is refused with the list.",
  );
