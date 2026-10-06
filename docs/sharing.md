# Sharing a deck

`share_deck` publishes one of the user's synced decks to AnkiWeb's public
catalogue. It is the only tool that changes anything other people can see, so
nothing is published unless the call says `confirm: true`.

It talks to the same endpoints the share page uses (see
[ankiweb.md](ankiweb.md#share-flow)) through the browser context's request API,
so it needs a session but renders no page.

## Layout

| module                    | does                                                             |
| ------------------------- | ---------------------------------------------------------------- |
| `src/ankiweb/service.ts`  | posts to a session-only `/svc/...` endpoint, maps 403 and errors |
| `src/ankiweb/protobuf.ts` | reads any message, and writes the few this server sends          |
| `src/ankiweb/share.ts`    | the share form's prefill, its limits, submitting, polling        |
| `src/tools/share.ts`      | picks the deck, builds the preview, publishes on confirm         |

## A call

1. **Pick the deck.** `deck` is an id or an exact full name from
   `list_my_decks`. A name two decks share is refused with both ids listed,
   never guessed. The Default deck is refused, since AnkiWeb will not share it.
2. **Read the form.** `deck-share-info` gives what the form is pre-filled with
   and how many shares the account made in the last seven days. A deck that
   carries a `shared_id` is already shared: the call stops and gives its link.
   Sharing it again would update that listing, which this tool does not do yet.
3. **Fill it.** `title`, `description`, `tags` and `supportUrl` override the
   prefill. Tags are a list of words without whitespace, sent space-separated.
4. **Check it.** Every limit the form enforces becomes a line in `problems`:
   a blank title or description, a field over its length (title 60, tags 60,
   support page 180, description 65 000), or 20 shares already this week.
5. **Without `confirm`,** the call returns the preview with
   `status: "preview"`, and its text starts "Preview only: nothing was
   published." Nothing is posted past `deck-share-info`.
6. **With `confirm: true`,** steps 1 to 4 run again from scratch, so a
   confirmed share never acts on what an earlier preview saw. Any problem
   refuses the call. Otherwise `deck-share` is posted with
   `confirm_copyright` set, which is the form's "I declare that the material I
   am sharing is entirely my own work…" checkbox, and the tool description says
   that the call makes that declaration for the user.
7. **Wait.** `deck-share-state` keeps the last share's outcome after it
   finishes, so it is read once before the submit, and that same answer is not
   taken for this share's. It is then polled every five seconds, as the share
   page does, for up to two minutes.
   - `SUCCESS` returns `status: "shared"` with the listing's id and URL, and
     says AnkiWeb hides a new listing from the public for 24 hours while
     copyright holders can check it.
   - `TOO_LARGE` and any unknown state are errors.
   - Still processing after two minutes returns `status: "pending"`, which
     tells the assistant not to share again.

The tool is annotated `destructiveHint: false`, `idempotentHint: false` and
`openWorldHint: true`, and its description tells the assistant to show the
preview to the user and get their go-ahead before confirming.
