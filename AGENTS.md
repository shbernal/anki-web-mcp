# AGENTS.md

`anki-web-mcp` is an MCP server that talks to AnkiWeb on the user's own session.
It is a client of a web service with no published API, so most of what can go
wrong here is AnkiWeb changing under it.

## AnkiWeb is observed, not specified

`docs/ankiweb.md` records every endpoint, message and field number the server
uses, as seen on the live site. `src/ankiweb/urls.ts` is the only module that
knows paths, and each decoder names its field numbers in a table that mirrors
that file.

The fixtures under `test/fixtures/ankiweb/` are recorded response bodies. When
AnkiWeb's frontend changes, refresh the doc, the field tables and the fixtures
together. A fixture re-recorded without the doc, or the reverse, leaves the
tests passing against a shape nobody checked.

## One Playwright importer

`src/browser/launch.ts` is the only module that imports Playwright's launcher.
If AnkiWeb ever starts fingerprinting automation, moving to `patchright`, which
has the same API, is a change to that one import. Keep it that way: the rest of
the code takes a `BrowserContext` or its `APIRequestContext`.

## Outward-facing tools take `confirm: true`

Any tool that changes something other people can see (today `share_deck`; any
later edit or removal of a listing) previews without `confirm: true` and acts
only with it. The confirmed call reads everything again rather than trusting the
preview, and the tool description tells the assistant to show the preview and
wait for the user. `docs/sharing.md` is the worked example.

## The data directory

`~/.anki-web-mcp/` by default, `0700`, holding `profile/` (Playwright's
persistent user-data dir), `profile.lock` (the process that has it open),
`cookies.json` (`0600`, the auth cookies only) and `downloads/`. Anything new
that launches a browser on `profile/` goes through `openLocked` or
`lockProfile` in `src/browser/profile-lock.ts`. `docs/session.md` has the rules. Cookie values are never logged:
`redact` in `src/errors.ts` masks them in every message and stack that leaves the
process.

## Errors

A tool throws a `ToolError` when its message is written for the user, and
anything else is logged and summarized (`docs/errors.md`). A new failure the
user can act on gets a `ToolError` with the action in its message.
