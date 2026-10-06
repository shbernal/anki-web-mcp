# Command line

`anki-web-mcp` with none of `--login`, `--logout`, `--import-from-browser` or
`--install-browser` serves MCP over stdio. Those four do their one job and
exit.

| flag                           | does                                                      |
| ------------------------------ | --------------------------------------------------------- |
| `--login`                      | signs in to AnkiWeb in a visible browser window           |
| `--logout`                     | deletes the stored session, keeping downloads             |
| `--import-from-browser [name]` | imports the session from a local browser now              |
| `--no-auto-import`             | never looks in local browsers on its own                  |
| `--install-browser`            | downloads Playwright's Chromium                           |
| `--channel <name>`             | drives an installed browser, such as `chrome`, instead    |
| `--data-dir <path>`            | keeps the session elsewhere; also `ANKI_WEB_MCP_DATA_DIR` |
| `-h`, `--help`                 | lists these flags                                         |

A flag it does not know, or a missing value, prints one line and exits with
status 2.

[session.md](session.md) covers what `--login`, `--logout`,
`--import-from-browser` and `--channel` do to the data directory.
