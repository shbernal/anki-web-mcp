# Browser session

The server drives one Chromium, through Playwright, against the signed-in
AnkiWeb session it keeps on disk. `src/browser/launch.ts` is the only module
that imports Playwright's launcher, so a drop-in such as patchright is a change
to that file alone.

## Data directory

`~/.anki-web-mcp/` by default, or `--data-dir <path>`, or
`ANKI_WEB_MCP_DATA_DIR`, with the flag winning over the variable.

| path           | holds                                                    |
| -------------- | -------------------------------------------------------- |
| `profile/`     | Playwright's persistent user-data dir                    |
| `cookies.json` | the auth cookies and when the session was last validated |
| `downloads/`   | the browser's download target                            |

The directory is created `0700` and `cookies.json` is written `0600`, through a
temporary file and a rename. A data dir owned by another user, or one whose
mode grants anything to group or others, is refused with the `chmod` that fixes
it, the same rule `ssh` applies to `~/.ssh`. On Windows neither check applies.

`cookies.json` keeps only `ankiweb` and `has_auth` on `ankiweb.net` and
`ankiuser.net` (see [ankiweb.md](ankiweb.md#session)), with the fields
Playwright's `addCookies` takes. It is rewritten after `--login` and after every
successful session check, so it follows the profile. When the server launches
on a profile that has no `ankiweb` cookie, it seeds the profile from this file.

## Signing in

```sh
anki-web-mcp --login
```

This opens a visible browser on `/account/login`, and the user signs in on
AnkiWeb's own form, so the password never passes through this process. The CLI
polls once a second. Once the `ankiweb` cookie exists and
`get-account-status` reports `logged_in`, it writes `cookies.json` and closes the
window. It gives up after ten minutes, or as soon as the window is closed.

`anki-web-mcp --logout` deletes `profile/` and `cookies.json` and keeps
`downloads/`. Each target is checked to be a direct child of the data dir
before the recursive delete.

`--channel chrome` (or any other Playwright channel) drives an installed browser
instead of Playwright's Chromium, for both the server and `--login`. When
Chromium is missing, the error points to `anki-web-mcp --install-browser`, which
runs the bundled Playwright CLI's `install chromium`.

## In the server

`BrowserSession` launches headless on the first call that needs a browser, and
concurrent calls share that one launch. It closes after five minutes with
nothing in flight, and the next call relaunches it. The session never opens a
headed window, since an MCP client over stdio may have no display. A tool that
needs a signed-in session gets an `AuthRequiredError` that says to run
`--login`.

The session check is `POST /svc/account/get-account-status` sent through the
context's request API. That request shares the browser's cookie jar, so the
check needs no page render. A result is reused for 30 seconds, so a tool call
that checks more than once costs one request.

The stdio transport does not notice its client going away. So the CLI waits for
stdin to end, then closes the server and the browser, because an open browser
would keep the process alive.

`server_status` reports `version`, `dataDir`, `sessionStored` (whether
`cookies.json` holds the session cookie) and `lastValidated`. With
`validate: true` it also starts the browser, checks the session against AnkiWeb
and adds `authenticated`.
