# Command line

`anki-web-mcp` with none of `--login`, `--logout`, `--status`,
`--import-from-browser` or `--install-browser` serves MCP over stdio. Those five
do their one job and exit.

| flag                           | does                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| `--login`                      | signs in to AnkiWeb in a visible browser window                                      |
| `--logout`                     | deletes the stored session, keeping downloads                                        |
| `--status`                     | checks the stored sessions with AnkiWeb; exits 1 if any is signed out                |
| `--import-from-browser [name]` | imports the session from a local browser now                                         |
| `--no-auto-import`             | never looks in local browsers on its own                                             |
| `--install-browser`            | downloads Playwright's Chromium                                                      |
| `--account <name>`             | the account the others act on, and the server's default; also `ANKI_WEB_MCP_ACCOUNT` |
| `--read-only`                  | lists no tool that changes anything on AnkiWeb; also `ANKI_WEB_MCP_READ_ONLY`        |
| `--channel <name>`             | drives an installed browser, such as `chrome`, instead                               |
| `--data-dir <path>`            | keeps everything in one directory; also `ANKI_WEB_MCP_DATA_DIR`                      |
| `-h`, `--help`                 | lists these flags                                                                    |

A flag it does not know, a missing value, or an account name outside the rule
in [session.md](session.md#accounts) prints one line and exits with status 2.

`--read-only` and `--no-read-only` win over `ANKI_WEB_MCP_READ_ONLY`, which
takes `1` or `true` for on and `0`, `false` or an empty value for off, in any
case; anything else is a usage error. Only serving reads it: the one-job flags
ignore it. A read-only server leaves `share_deck` and `unshare_deck` unregistered,
so no client lists them, and `server_status` reports `readOnly: true`.

[session.md](session.md) covers what `--login`, `--logout`,
`--import-from-browser` and `--channel` do to the data directory.
