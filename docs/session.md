# Browser session

The server drives one Chromium, through Playwright, against the signed-in
AnkiWeb session it keeps on disk. `src/browser/launch.ts` is the only module
that imports Playwright's launcher, so a drop-in such as patchright is a change
to that file alone.

## Data directory

`--data-dir <path>`, or `ANKI_WEB_MCP_DATA_DIR`, puts everything under that one
directory, with the flag winning over the variable. Without either, the
location depends on the platform:

| file           | Linux                           | macOS, Windows     |
| -------------- | ------------------------------- | ------------------ |
| `profile/`     | `$XDG_STATE_HOME/anki-web-mcp/` | `~/.anki-web-mcp/` |
| `cookies.json` | `$XDG_STATE_HOME/anki-web-mcp/` | `~/.anki-web-mcp/` |
| `profile.lock` | `$XDG_STATE_HOME/anki-web-mcp/` | `~/.anki-web-mcp/` |
| `downloads/`   | `$XDG_DATA_HOME/anki-web-mcp/`  | `~/.anki-web-mcp/` |

| file           | holds                                                      |
| -------------- | ---------------------------------------------------------- |
| `profile/`     | Playwright's persistent user-data dir                      |
| `cookies.json` | the auth cookies and when the session was last validated   |
| `profile.lock` | which process has `profile/` open, while one does          |
| `downloads/`   | where `download_shared_deck` saves when given no directory |

`XDG_STATE_HOME` defaults to `~/.local/state` and `XDG_DATA_HOME` to
`~/.local/share`. A relative or empty value is ignored, as the spec says. The
session counts as state rather than data: losing it costs a sign-in, not work.
On Linux, a `~/.anki-web-mcp/` left from before this layout is kept in use, as
one directory, until the state dir exists. Nothing is moved.

The directory holding the session (the "data dir" below) is created `0700`, and
`cookies.json` is written `0600`, through a temporary file and a rename. A data
dir owned by another user, or one whose mode grants anything to group or
others, is refused with the `chmod` that fixes it, the same rule `ssh` applies
to `~/.ssh`. On Windows neither check applies. `downloads/` is created `0700`
too but never checked, since it holds no secrets.

### Accounts

One data dir can hold several AnkiWeb sessions, each under a name the user
picks:

```
<data dir>/
  profile/  cookies.json  profile.lock     # the account named "default"
  accounts/<name>/
    profile/  cookies.json  profile.lock
```

The default account is the one at the root, so a session stored before
accounts had names is the default account, and a single-account user never
gets an `accounts/` directory: it is created with the first named account.
Every account shares `downloads/`.

A name is 1 to 32 lowercase letters, digits, `-` or `_`, starting with a letter
or digit. `default` always means the root. AnkiWeb exposes no endpoint we know
of that names the signed-in user, so the name is only the user's label, not an
AnkiWeb username.

The default account is listed once the root holds `profile/` or
`cookies.json`, and a named one for each validly named directory under
`accounts/`; anything else there is ignored and left alone. `accounts/` and
each account's directory are created `0700` and checked like the data dir.

on `ankiweb.net` and
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

`--login --account <name>`, or `ANKI_WEB_MCP_ACCOUNT`, signs in a named
account instead, creating its directory; the flag wins over the variable.
`--logout` and `--import-from-browser` take `--account` the same way.

`anki-web-mcp --status` asks AnkiWeb about the session in `cookies.json` and
exits 0 when it is signed in, 1 when nothing is stored or AnkiWeb turns it
down. With `--account` it checks that account. Without, it checks every
account listed, one line each (`work: signed out; run --login --account work`),
and exits 1 if any is not signed in. With only the default account stored, or
nothing at all, it prints the one line it did before accounts had names. It sends the same `get-account-status` POST as `server_status` over
`fetch`, so it opens no browser, takes no profile lock and can run beside the
server. It never reads `profile/`, which can hold a newer cookie than the file
after the server's browser has run; `server_status` with `validate: true`
covers that case.

`anki-web-mcp --logout` deletes `profile/` and `cookies.json` and keeps
`downloads/`. A named account's directory goes with them, unless something
else was put in it. Each target is checked to be a direct child of its
account's directory before the recursive delete.

## One browser per profile

Chromium's own `SingletonLock` does not protect the profile here: Playwright's
headless shell never writes one, and a second launch on a profile in use
succeeds, leaving two browsers writing one cookie store. So whatever opens
`profile/` (the server's browser, `--login`, `--import-from-browser`) first
creates `profile.lock` exclusively, holding its pid, what it is, and a random
token. It removes the file when its browser closes, crashes included, and only
while the token is still its own.

A process that finds the lock held by another live pid stops with a
`ProfileInUseError` saying which process has it and how to free it:
`close_session` or five idle minutes for the server, finishing or closing the
window for `--login`. `--logout` refuses the same way rather than delete a
profile under a running browser. A lock whose pid is gone, or that does not
parse, is taken over.

## Importing from a local browser

```sh
anki-web-mcp --import-from-browser          # or: auto
anki-web-mcp --import-from-browser brave
```

A named account needs the browser named (`--import-from-browser brave
--account work`). `auto` picks whichever profile used AnkiWeb last, which says
nothing about whose session that is, so it signs in only the default account,
and so does the automatic import in the server. Even a named browser can hold
more than one AnkiWeb session across its profiles, and two accounts can end up
holding the same session. Nothing detects that: AnkiWeb has no endpoint we know
of that names the signed-in user.

This reuses an AnkiWeb session the user already has in a Chromium-family
browser: `chrome`, `chromium`, `brave`, `edge`, `vivaldi`, `opera` on Linux and
macOS, plus `arc` and `helium` on macOS. Windows is not supported yet.

Discovery looks in each browser's user-data dir (`~/.config/<browser>` or
`$XDG_CONFIG_HOME` on Linux, `~/Library/Application Support/<browser>` on
macOS) and in sibling channels such as `google-chrome-beta`. It lists `Default`
and every `Profile N`, with the `Cookies` database under `Network/` or beside
it. Opera keeps one profile at the root.

Each database is copied to a private temporary directory along with its `-wal`
and `-shm`, because the running browser holds a lock and recent writes may sit in
the WAL. It is opened read-only through `node:sqlite`, and the copy is deleted
afterwards. Ranking reads only plaintext columns, so no keystore is touched
before a candidate is chosen. A profile is a candidate when it has an `ankiweb`
cookie on `ankiweb.net` that has not expired and is encrypted as `v10` or
`v11`. Candidates are tried newest `last_access_utc` first.

Only the candidate being tried is decrypted. The key is PBKDF2-HMAC-SHA1 over
the salt `saltysalt`, 16 bytes, from:

| OS    | prefix | password                                                      | iterations |
| ----- | ------ | ------------------------------------------------------------- | ---------- |
| Linux | `v10`  | `peanuts`, Chromium's built-in one                            | 1          |
| Linux | `v11`  | `secret-tool lookup application <browser>`, then KWallet      | 1          |
| macOS | `v10`  | `security find-generic-password -w -s <service> -a <account>` | 1003       |

On Linux, a key the Secret Service (GNOME Keyring, KeePassXC) does not have is
read from KWallet next, with `kwallet-query --read-password "<name> Safe
Storage" --folder "<name> Keys" kdewallet`. `<name>` is the product name
Chromium files it under, which yt-dlp records as `Chrome`, `Chromium` and
`Brave`, with Vivaldi under `Chrome` and Edge and Opera under `Chromium`. Only
the default wallet, `kdewallet`, is asked. `kwallet-query` prints "Failed to
read" and exits 0 for a missing entry, which counts as no key.

Values are AES-128-CBC with an IV of 16 spaces. From the store's
`meta.version` 24 on, the plaintext opens with SHA256(`host_key`), which is
stripped and doubles as a wrong-key check. A keystore read times out after ten
seconds. On macOS it shows one keychain prompt per browser tried. `v20`
(app-bound) values are skipped.

The decrypted `ankiweb` and `has_auth` cookies go into the server's browser
context, and the session check from [In the server](#in-the-server) decides.
On success they are exported to `cookies.json` like after `--login`. On
rejection they are cleared from the context and the next candidate is tried.

The profile list, the keystore names and the decryption steps are ported from
linkedin-mcp-server (Apache-2.0); see `NOTICE`.

`--channel chrome` (or any other Playwright channel) drives an installed browser
instead of Playwright's Chromium, for both the server and `--login`. When
Chromium is missing, the error points to `anki-web-mcp --install-browser`, which
runs the bundled Playwright CLI's `install chromium`.

## In the server

`BrowserSession` launches headless on the first call that needs a browser, and
concurrent calls share that one launch. It closes after five minutes with
nothing in flight, and the next call relaunches it. `close_session` closes it
sooner, once the call in progress has finished.

Calls that use the browser take turns: each waits for the one before it,
whether that one succeeded or failed. A session check, a cookie import and a
share never interleave on the one cookie jar. A share that waits on AnkiWeb
holds its turn for up to two minutes, and calls behind it wait too. Calls that
need no browser, such as searches and anonymous downloads, do not queue. The session never opens a
headed window, since an MCP client over stdio may have no display. The first time a
tool needs a signed-in session and there is none, the server runs the browser
import above with `auto`, once per process. If that fails too, the tool gets an
`AuthRequiredError` that gives the import's reason and says to run `--login`.
`--no-auto-import` turns the automatic attempt off.

The session check is `POST /svc/account/get-account-status` sent through the
context's request API. That request shares the browser's cookie jar, so the
check needs no page render. A result is reused for 30 seconds, so a tool call
that checks more than once costs one request.

The stdio transport closes itself when the client closes stdin, but an open
browser would still keep the process alive. So the CLI also waits for stdin to
end, then closes the server and the browser. The browser cannot be released from
a server's `onclose` instead, because `serveStdio` also builds and closes
throwaway server instances to answer `server/discover` probes.

`server_status` reports `version`, `dataDir` (where the session is),
`downloadsDir`, `sessionStored` (whether
`cookies.json` holds the session cookie) and `lastValidated`. With
`validate: true` it also checks the session against AnkiWeb and adds
`authenticated`. When no browser is open, that is the same `get-account-status`
POST sent over `fetch` with the stored `ankiweb` cookie, which costs one request
and no Chromium; a yes refreshes `validatedAt`. A browser already open is asked
instead. A stored cookie that is missing or turned down falls back to launching
the browser, since the profile may hold a newer one.

`list_my_decks` posts `deck-list-info` the same way, after the same session
check, and flattens the tree so each parent comes before its subdecks. Each
deck carries its full `Parent::Child` name: a node's name is joined to its
parent's unless it already starts with it, which covers either way AnkiWeb
might send subdeck names.
