# Errors and pacing

## What a failing tool returns

Every tool handler is wrapped by `guarded` in `src/errors.ts`, so whatever it
throws comes back as a tool result with `isError: true` and a message an
assistant can act on.

- **A `ToolError`** carries a message written for the user, and it is returned
  as is. The errors this server anticipates all extend it:
  `AuthRequiredError` (says to run `--login`), `BrowserMissingError` (says to
  run `--install-browser`), `AnkiWebHttpError`, `InvalidSharedIdError`,
  `DataDirError`, `DownloadError`, and the plain `ToolError`s the tools throw
  for an unknown or ambiguous deck.
- **A payload that does not decode** (`ProtobufError`) is the first sign that
  AnkiWeb changed. The message says so and links the issue tracker.
- **A network failure** (`ENOTFOUND`, `ECONNREFUSED` and similar) and **a
  timeout** each get one line saying what happened.
- **Anything else** is logged to stderr with its stack, and the result only
  says that the tool failed and where the details are.

Cookie values never leave the process: `ankiweb=` and `has_auth=` values are
masked in every returned message and every logged stack.

## Pacing

AnkiWeb is a small service run by one developer. Every request this process
sends to it, anonymous or signed in, waits until at least one second has
passed since the previous one (`src/ankiweb/throttle.ts`). Cached responses
send nothing and do not wait.

A request that has not had its response headers after 30 seconds is abandoned,
the same timeout Playwright's request API applies by default. A download's
body is not timed, since a large deck can take minutes to stream.
