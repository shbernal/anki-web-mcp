# AnkiWeb surface

What this server talks to on `ankiweb.net`, as observed in October 2026. AnkiWeb
publishes no API, so anything here can change without notice. When a call starts
failing, check this file against the live site first.

## Terms of service

`/account/terms`, section "Access":

> You may access AnkiWeb directly through your browser, and through the
> synchronization functionality incorporated into the approved clients (Anki,
> AnkiMobile, AnkiDroid, and AnkiUniversal). Because other clients can cause
> problems, AnkiWeb does not currently allow access from browser extensions or
> other third-party clients. Instead, please use AnkiConnect, which lets you
> modify your local connection over a web socket without any negative impact on
> AnkiWeb. As the service is provided to you at no charge, we reserve the right to
> suspend or remove your access to the service at our sole discretion.

On downloaded shared decks:

> This license is for personal use only, and the deck may not be redistributed,
> re-uploaded, published, or used for any other purposes without explicit
> permission from the copyright holder.

## Architecture

The site is a SvelteKit single-page app. Every page's HTML is the same shell, and
the data comes from `/svc/<area>/<method>` endpoints that speak protobuf
(`application/octet-stream`, encoded with `@bufbuild/protobuf`). Saved page HTML
therefore holds no data worth testing against; the protobuf payloads do.

The app calls these endpoints in two ways:

- **Cacheable reads** are `GET /svc/...?<query>`, where the query string is the
  request message's fields in camelCase (`?sharedId=123`) and the response body
  is protobuf. Responses carry `cache-control: max-age=600`.
- **Everything else** is `POST /svc/...`, with the request message as a protobuf
  body and `Content-Type: application/octet-stream`. An empty message is a
  zero-length body.

Errors:

- **403** means the call needs a session. The app reacts by setting
  `window.location.href = "/account/login"`, so the redirect happens in the
  client, not over HTTP.
- **Other 4xx/5xx** responses have a `text/plain` body carrying the reason, such
  as `Failed to deserialize query string: missing field \`t\``.

Field names below are the protobuf names as they appear in the bundle. Integer
types are protobuf scalar types, and `int64` timestamps are Unix seconds.

## Rate limiting

`/svc/shared/list-decks` returned `429` with the body `Failed to parse input.`
after about four searches in a minute from one IP. Requests 15 s apart were
still refused, and the limit had not cleared after another minute. The response
carries no `Retry-After` or rate-limit headers. No Cloudflare challenge or bot
check showed up, in headless Chromium or in `curl`.

## Shared decks

None of these need a session.

### Search

`GET /svc/shared/list-decks?search=<text>`

The page `/shared/decks?search=<text>&sort=<rating|title|modified>` calls it.
Sorting happens client-side, so `sort` never reaches the server. Results come
back in a single response with no pagination: `japanese` returned 1899 rows in
115 kB. An empty search returns `200` with an empty body.

The page disables its search button when the query, with spaces removed, is
shorter than three characters and entirely alphanumeric. It shows "Too many
matches found. Please refine your search." when the result set is too large.

```
ListDecksResponse { repeated Row rows = 1; }
Row {
  uint32 id = 1;            // shared id, as in /shared/info/<id>
  string title = 2;
  uint32 thumbs_up = 3;
  uint32 thumbs_down = 4;
  int64  mtime = 5;
  uint32 notes = 6;
  uint32 audio = 7;
  uint32 images = 8;
}
```

### Details

`GET /svc/shared/item-info?sharedId=<id>`, called by `/shared/info/<id>`.

```
ItemInfoResponse {
  Available available = 1;
  bool missing = 2;
  bool access_denied = 3;
}
Available {
  repeated Review reviews = 1;
  bool   is_owner = 4;
  string title = 5;
  string tags = 6;          // space-separated, padded with spaces
  uint32 size = 7;          // bytes of the .apkg
  int64  last_updated = 8;
  string description = 9;   // HTML
  Deck   deck = 10;
  Addon  addon = 11;        // set for add-ons instead of deck
  optional string support_url = 12;
  uint32 items_shared_by_user = 13;
  // 14 admin_info, 15 just_uploaded, 16 is_suspended, 17 is_copyright_holder
  uint32 thumbs_up = 18;
  uint32 thumbs_down = 19;
  string original_deck_name = 20;
  bool   too_new_for_rating = 21;
}
Deck {
  uint32 notes = 1;
  uint32 audio = 2;
  uint32 images = 3;
  repeated SampleNote sample_notes = 4;   // fields: repeated { name = 1; value = 2; }
  string download_key = 5;
}
Review {
  int64  post_timestamp = 1;
  bool   thumbs_up = 2;
  string body = 4;
  optional string reply_text = 5;
  optional int64  reply_timestamp = 6;
}
```

- **Unknown ids** get `200` and a body holding only `missing = true`.
- **Reviews** come newest first, and a popular deck has hundreds: one with 401
  reviews answered 17 kB, and one with 1579 answered 295 kB.
- **Sample fields** arrive as text with the HTML already stripped, and media
  rewritten to `[sound:0.mp3]` and `[image:1.jpg]`. Both are served from
  `/shared/mpreview/<id>/<file>` with no session.
- **Descriptions** are HTML, in whatever shape the deck was shared with. Recent
  ones are Markdown rendered to `<p>`, `<a>`, `<ul>`, `<strong>` and `<img>`;
  old ones are plain text with newlines.

The rendered page has a single `button` named "Download", a `heading` per
section ("Description", "Sample (from N notes)", "Reviews"), and links to
`/shared/review/<id>` and `/shared/by-author/<id>`.

### Download

`GET /svc/shared/download-deck/<id>?t=<download_key>`

The Download button fetches this URL, and the browser fires a real `download`
event for it. The response is the `.apkg` itself (`application/octet-stream`,
`content-disposition: attachment; filename=<Title_With_Underscores>.apkg`).

- No session is needed, and a plain `fetch`/`curl` with no cookies gets the
  same bytes. So a download is two HTTP calls with no page render.
- `t` is required. Without it the call returns `400` and "missing field `t`".
- `download_key` has the shape of a JWT: the header segment decodes to
  `{"op":"sdd","iat":<unix seconds>,"jv":1}`. A key minted a few minutes earlier
  was still accepted; the expiry is unknown.

## Session

Observed on a signed-in session.

- **Login:** the `/account/login` form sends `POST /svc/account/login` with
  `{ string username = 1; string password = 2; }` and gets back
  `{ LoginResponseStatus status = 1; string token = 2; }`. Status 0 is
  `UNKNOWN`, 1 is `AUTHENTICATED` and 2 is `INVALID_USER`. The page then passes
  through `GET https://ankiuser.net/account/ankiuser-login` (`303`), which sets
  the same cookies on `ankiuser.net`, and lands back on AnkiWeb. Logging in
  from a fresh browser profile asked for no 2FA, email code or CAPTCHA.
- **Cookies:** two per domain, on both `ankiweb.net` and `ankiuser.net`.
  - `ankiweb` is the session: `HttpOnly`, `Secure`, `SameSite=Lax`, a
    150-character value, and an expiry 400 days out.
  - `has_auth` is a one-character, script-readable flag.
- **The smallest set is `ankiweb` on `ankiweb.net` alone.** Injected into a fresh
  context, it is enough for `deck-list-info` to return `200`. Each of the other
  three cookies alone gets `403`, as does no cookie at all.
- **Session check:** `POST /svc/account/get-account-status` (empty request)
  returns `{ bool logged_in = 1; optional string redirect_to = 2; }`. Any
  session-only call returns `403` without a valid session; the app reacts by
  moving to `/account/login`.
- **Terms gate:** `POST /svc/account/check-terms` (empty request) returns
  `{ bool needs_to_confirm = 1; }`, which was empty (false) on a fresh account.
- **Links to `ankiuser.net`:** the navigation's "Add" link goes to
  `https://ankiuser.net/add`, the host that serves the note editor.

## The user's decks

`/decks` calls `POST /svc/decks/deck-list-info`, with
`{ optional int32 minutes_west_of_utc = 1; }` and an empty body accepted.

```
DeckListInfoResponse {
  DeckNode top_node = 1;          // unnamed root; the decks are its children
  int64  current_deck_id = 2;
  uint32 collection_size_bytes = 3;
  uint64 media_size_bytes = 4;
}
DeckNode {
  int64  deck_id = 1;
  string name = 2;
  repeated DeckNode children = 3;
  uint32 level = 4;               // 1 for top-level decks
  bool   collapsed = 5;
  uint32 review_count = 6;
  uint32 learn_count = 7;
  uint32 new_count = 8;
  uint32 total_in_deck = 13;
  uint32 total_including_children = 14;
  bool   filtered = 16;
}
```

- **Deck ids:** "Default" is deck `1`. A deck created on the web gets its
  creation time in milliseconds as its id (for example `1791280883007`).
- **The empty Default deck is hidden:** it is left out of the tree once any
  other deck exists.
- **Page layout:** each deck is a `button` with its name, next to an "Actions"
  `button` whose menu offers "Rename", "Share" and "Delete".
  - "Share" goes to `/decks/share/<deck_id>`.
  - "Delete" asks "Delete all cards in deck? This can not be undone." in a
    native `confirm()` dialog, then sends `POST /svc/decks/remove-deck` with
    `{ int64 deck_id = 1; }`.
  - "Create Deck" prompts for a name with `prompt()` and sends
    `POST /svc/decks/create-deck` with `{ string name = 1; }`.
  - The default deck can't be shared: the page says to move its cards into a
    new deck first.

`/shared/mine` ("My Shared Items") calls `POST /svc/shared/list-mine` (empty
request). It returns `items` 1 (repeated `{ id, title, thumbs_up, thumbs_down,
mtime, downloads = 6 }`), `reviews` 2 and `expired_decks` 3; the body is empty
when nothing is shared. The bundle removes a shared item with
`POST /svc/shared/remove-item` and `{ uint32 shared_id = 1; }`. That page's
controls for it have not been seen, because the test account had nothing
shared.

### Share flow

1. **Load the form.** `/decks/share/<deck_id>` (heading "Share Deck") loads
   `POST /svc/decks/deck-share-info` with `{ int64 deck_id = 1; }`. The response
   is `{ Metadata metadata = 1; bool is_large_user = 2; uint32 share_count = 3; }`,
   where `Metadata` is `{ title = 1; tags = 2; support_url = 3; description = 4;
int64 deck_id = 5; optional uint32 shared_id = 6; }`. The form is pre-filled
   from it, and `shared_id` is set when the deck was shared before. For a deck
   never shared, the response holds only `metadata.deck_id`.
2. **Fill it in.** Every field is reachable by its label:

   | label                                                                                                                                                     | control                        | limit | required |
   | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----- | -------- |
   | Title                                                                                                                                                     | text input                     | 60    | yes      |
   | Tags                                                                                                                                                      | text input, space-separated    | 60    | no       |
   | Support Page                                                                                                                                              | text input                     | 180   | no       |
   | Description                                                                                                                                               | textarea, rendered as Markdown | 65000 | yes      |
   | I declare that the material I am sharing is entirely my own work, or I have obtained a license from the intellectual property holder(s) to share it here. | checkbox                       |       | yes      |

   The page states the weekly quota as "N/20 shares in last 7 days." The
   "Share" button stays disabled until title and description are non-blank, the
   box is checked, and `share_count < 20`. That was checked live: filling both
   fields left it disabled, and ticking the box enabled it.

3. **Submit.** Submitting sends `POST /svc/decks/deck-share` with
   `{ Metadata metadata = 1; bool confirm_copyright = 2; }` (empty response),
   then navigates to `/decks/share/pending`. This step was not run.
4. **Wait for the result.** The pending page ("Share Status") polls
   `POST /svc/decks/deck-share-state` (empty request) every 5 s while the state is
   `WAITING` or `IN_PROGRESS`. The response is
   `{ DeckShareState state = 1; optional uint32 shared_id = 2; }`, where state 0
   is `NO_ACTIVE_SHARE`, 1 `WAITING`, 2 `IN_PROGRESS`, 3 `SUCCESS`, 4 `TOO_LARGE`,
   and `UNKNOWN_ERROR` also exists. On `SUCCESS`, `shared_id` gives
   `/shared/info/<shared_id>`. With nothing in flight the page reads "No share
   is currently active."
