# Shared decks

`search_shared_decks` and `get_shared_deck` read AnkiWeb's public catalogue.
Both are anonymous `GET`s (see [ankiweb.md](ankiweb.md#shared-decks)), so they
use Node's `fetch` and never start the browser or ask for a session. They work
before anyone has signed in.

## Layout

| module                          | does                                                  |
| ------------------------------- | ----------------------------------------------------- |
| `src/ankiweb/urls.ts`           | builds every AnkiWeb URL; no other module knows paths |
| `src/ankiweb/ids.ts`            | turns an id or a `/shared/info/<id>` link into an id  |
| `src/ankiweb/protobuf.ts`       | a schema-less protobuf reader                         |
| `src/ankiweb/response-cache.ts` | `GET`s with a `max-age` cache, and AnkiWeb's errors   |
| `src/ankiweb/shared.ts`         | decodes search rows and listings into typed objects   |
| `src/ankiweb/html.ts`           | turns a description into text                         |
| `src/tools/shared.ts`           | the two tools: schemas, sorting, paging, summaries    |

The protobuf reader decodes a message into its field numbers and leaves typing
to the caller, so `shared.ts` names each message's field numbers in a table
that mirrors `ankiweb.md`. There is no generated code and no protobuf
dependency.

## Rate limit and cache

AnkiWeb answers `429` after about four searches a minute. Every response that
carries `max-age` (AnkiWeb sends 600 s) is kept in memory for that long, keyed
by URL, up to 50 entries. So repeating a search, or paging through one, costs
one request. A `429` becomes a tool error that tells the caller to wait.

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
