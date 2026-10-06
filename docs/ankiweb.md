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

The rendered page has a single `button` named "Download", a `heading` per
section ("Description", "Sample (from N notes)", "Reviews"), and links to
`/shared/review/<id>` and `/shared/by-author/<id>`. Sample audio is served from
`/shared/mpreview/<id>/<n>.mp3`.

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

## Session and the user's decks

This part is not yet verified against a signed-in session. Everything below
comes from the client bundle.

- **Login:** `POST /svc/account/login` takes `{ string username = 1; string password = 2; }`
  and returns `{ LoginResponseStatus status = 1; string token = 2; }`, where status
  0 is `UNKNOWN`, 1 is `AUTHENTICATED` and 2 is `INVALID_USER`. The cookie or
  cookies it sets, and whether 2FA or a CAPTCHA follows, have not been observed.
- **Session check:** `POST /svc/account/get-account-status` returns
  `{ bool logged_in = 1; optional string redirect_to = 2; }`. Without a session,
  `POST /svc/decks/deck-list-info` returns `403` and the `/decks` page moves to
  `/account/login`.
- **Terms gate:** `POST /svc/account/check-terms` returns `{ bool needs_to_confirm = 1; }`.
- **The user's decks:** `/decks` calls `POST /svc/decks/deck-list-info`
  (`{ optional int32 minutes_west_of_utc = 1; }`), which returns
  `{ DeckNode top_node = 1; int64 current_deck_id = 2; uint32 collection_size_bytes = 3; uint64 media_size_bytes = 4; }`.
  A `DeckNode` holds `deck_id` (int64) 1, `name` 2, `children` 3 (repeated
  `DeckNode`), `level` 4, `collapsed` 5, `review_count` 6, `learn_count` 7,
  `new_count` 8, `total_in_deck` 13, `total_including_children` 14 and
  `filtered` 16. Each deck's share link is `/decks/share/<deck_id>`. The default
  deck can't be shared: the page says to move its cards into a new deck first.
- **Decks the user has shared:** `/shared/mine` calls `POST /svc/shared/list-mine`
  (empty request), which returns `items` 1 (repeated `{ id, title, thumbs_up,
thumbs_down, mtime, downloads = 6 }`), `reviews` 2 and `expired_decks` 3.
  Removing one is `POST /svc/shared/remove-item` with `{ uint32 shared_id = 1; }`.

### Share flow

1. **Load the form.** `/decks/share/<deck_id>` loads
   `POST /svc/decks/deck-share-info` with `{ int64 deck_id = 1; }`. The response
   is `{ Metadata metadata = 1; bool is_large_user = 2; uint32 share_count = 3; }`,
   where `Metadata` is `{ title = 1; tags = 2; support_url = 3; description = 4;
int64 deck_id = 5; optional uint32 shared_id = 6; }`. The form is pre-filled
   from it, and `shared_id` is set when the deck was shared before.
2. **Fill it in.** The fields are labelled "Title" (max 60, required), "Tags"
   (max 60, optional, space-separated), "Support Page" (max 180, optional), a
   description textarea (required), and a copyright confirmation checkbox
   (required). Submit stays disabled until title and description are non-blank,
   the box is checked, and `share_count < 20`.
3. **Submit.** Submitting sends `POST /svc/decks/deck-share` with
   `{ Metadata metadata = 1; bool confirm_copyright = 2; }` (empty response),
   then navigates to `/decks/share/pending`.
4. **Wait for the result.** The pending page polls
   `POST /svc/decks/deck-share-state` (empty request) every 5 s while the state is
   `WAITING` or `IN_PROGRESS`. The response is
   `{ DeckShareState state = 1; optional uint32 shared_id = 2; }`, where state 0
   is `NO_ACTIVE_SHARE`, 1 `WAITING`, 2 `IN_PROGRESS`, 3 `SUCCESS`, 4 `TOO_LARGE`,
   and `UNKNOWN_ERROR` also exists. On `SUCCESS`, `shared_id` gives
   `/shared/info/<shared_id>`.
