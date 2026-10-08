# Shared decks

`search_shared_decks` and `get_shared_deck` read AnkiWeb's public catalogue,
and `download_shared_deck` saves a deck from it. All three are anonymous `GET`s
(see [ankiweb.md](ankiweb.md#shared-decks)), so they use Node's `fetch` and
never start the browser or ask for a session, with one exception: once AnkiWeb
stops allowing anonymous downloads, a download borrows the session's cookie,
from `cookies.json` if it can and from the browser if it must.

## Layout

| module                          | does                                                      |
| ------------------------------- | --------------------------------------------------------- |
| `src/ankiweb/urls.ts`           | builds every AnkiWeb URL; no other module knows paths     |
| `src/ankiweb/ids.ts`            | turns an id or a `/shared/info/<id>` link into an id      |
| `src/ankiweb/protobuf.ts`       | a schema-less protobuf reader                             |
| `src/ankiweb/response-cache.ts` | `GET`s with a `max-age` cache, and AnkiWeb's errors       |
| `src/ankiweb/shared.ts`         | decodes search rows and listings into typed objects       |
| `src/ankiweb/html.ts`           | turns a description into text                             |
| `src/tools/shared.ts`           | search and details: schemas, sorting, paging, summaries   |
| `src/save-apkg.ts`              | filenames, the target directory, writing the `.apkg`      |
| `src/tools/download.ts`         | the download tool: schemas, saving, its summary           |
| `src/tools/start-download.ts`   | anonymous first, then the stored cookie, then the browser |

The protobuf reader decodes a message into its field numbers and leaves typing
to the caller, so `shared.ts` names each message's field numbers in a table
that mirrors `ankiweb.md`. There is no generated code and no protobuf
dependency.

## Rate limit and cache

AnkiWeb answers `429` after about four searches a minute. Every response that
carries `max-age` (AnkiWeb sends 600 s) is kept in memory for that long, keyed
by URL, up to 50 entries. So repeating a search, or paging through one, costs
one request. A `429` becomes a tool error. A
refused search is worded as the search limit, since its body ("Failed to parse
input.") says nothing. That wording says a block has been seen to last over an
hour, and that details and downloads keep working meanwhile, so a deck id already
in hand is still usable. Any other `429` quotes AnkiWeb's body, which for a
download is "Please log in to download more decks." A signed-in download refused
with "Daily limit exceeded; please try again tomorrow." is worded as a daily
cap instead, since waiting minutes does not lift it.

## Search

AnkiWeb returns every match in one response, unsorted, so `sort`, `page` and
`limit` are applied by the tool. `rating` sorts by thumbs up minus thumbs
down, then by thumbs up. AnkiWeb's own ranking for that sort is not known.
`modified` is newest first.

## Details

- **Input:** `deck` takes an id, a full link, `ankiweb.net/shared/info/<id>`
  without a scheme, or the bare path. Any other host or path is refused.
- **Description:** converted to plain text that keeps links and images as
  `[text](href)` and `![alt](src)`, with list items as `- ` lines.
- **Samples:** each sample note lists its media as URLs.
- **Reviews:** the newest ten by default, since a popular deck has hundreds.
  `reviews` asks for more, and `reviewCount` gives the total.
- **Add-ons:** AnkiWeb lists add-ons under the same ids. A listing without a
  deck comes back as `kind: "addon"` with no counts or samples.
- **Download key:** `shared.ts` decodes it and the tool leaves it out of its
  output.

## Download

- **Request:** the listing (from the cache when it is there) gives the
  download key, and the deck is fetched with it. The body is streamed to disk
  rather than held in memory.
- **Session:** the first attempt carries no cookie. When AnkiWeb answers `429`,
  the download is sent again with the `ankiweb` cookie the account's
  `cookies.json` holds, read without the browser or the profile lock. If there
  is none, or AnkiWeb asks for a login again, the browser session checks it is
  signed in, importing one if it can, and the download is sent once more with
  its cookie, since the profile may hold a newer one. A daily limit on the
  stored cookie is final: the browser's would get the same answer. With no
  session the error says why one is needed and how to sign in.
- **`via`:** the output says whether the download went through `anonymous` or
  with the `session`, and the summary line ends in "signed in" for the latter.
  A signed-in download counts towards the account's daily cap.
- **Directory:** the `downloads/` directory from
  [session.md](session.md#data-directory) unless the call names one, which has to
  be an absolute path to an existing directory. That is checked before anything
  is fetched.
- **Filename:** the one in `content-disposition`, or the deck's title, or its
  id. Any directory part is dropped, characters Windows refuses and control
  characters become `_`, leading and trailing dots and spaces go, a Windows
  device name gets a `_` prefix, and the result always ends in `.apkg`.
- **No overwrites:** the file is created exclusively, and a name already taken
  becomes `name (1).apkg`, `name (2).apkg` and so on.
- **Contents:** the first four bytes must be a zip header (`PK\x03\x04`), or
  nothing is written and the error quotes what came back. A transfer that fails
  part way removes its file.
- **Add-ons** have no download key and are refused.

## Converting to Markdown

`convert_deck_to_markdown` takes an absolute path to a local `.apkg`, such as
one `download_shared_deck` saved, and writes it as
[Flashcard Markdown](https://github.com/shbernal/flashcard-md-spec) through
`@ankimd/core`'s `readDeck`, the same conversion as `ankimd extract`. Nothing
goes over the network.

- **Layout:** a new folder named after the package, beside it unless the call
  names an existing absolute directory, holding `<name>.md` and the images its
  cards use under `.images/`. A folder already taken becomes `name (1)` and so
  on, and every file is created exclusively, so nothing is replaced.
- **Title:** the call's `title`, or the filename with AnkiWeb's underscores as
  spaces.
- **What is lost:** only basic two-field notes become cards. Cloze notes and
  note types with more fields are counted, one diagnostic per reason, and
  scheduling is never carried over. The tool returns the first 50 diagnostics
  and the total.
- **Media names** come from a stranger's package, so one that would resolve
  outside `.images/` is not written; a diagnostic names it and the card keeps
  the reference as written.
