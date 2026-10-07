# Sharing a deck, and removing a listing

`share_deck` publishes one of the user's synced decks to AnkiWeb's public
catalogue, and `unshare_deck` takes one of the user's listings off it. Both
change what other people can see, so neither acts unless the call says
`confirm: true`. Both are left out entirely when the server runs with
[`--read-only`](cli.md).

They talk to the same endpoints AnkiWeb's own pages use (see
[ankiweb.md](ankiweb.md#share-flow) and
[ankiweb.md](ankiweb.md#shared-items)) through the browser context's request
API, so they need a session but render no page.

## Layout

| module                     | does                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| `src/ankiweb/service.ts`   | posts to a session-only `/svc/...` endpoint, maps 403 and errors |
| `src/ankiweb/protobuf.ts`  | reads any message, and writes the few this server sends          |
| `src/ankiweb/share.ts`     | the share form's prefill, its limits, submitting, polling        |
| `src/ankiweb/my-shared.ts` | lists the user's listings, removes one                           |
| `src/tools/choose.ts`      | picks one item by id or exact name, refusing to guess            |
| `src/tools/share.ts`       | picks the deck, builds the preview, publishes on confirm         |
| `src/tools/unshare.ts`     | picks the listing, builds the preview, removes on confirm        |
| `src/tools/acting.ts`      | registers the tools that act, which `--read-only` leaves out     |

## A call

1. **Pick the deck.** `deck` is an id or an exact full name from
   `list_my_decks`. A name two decks share is refused with both ids listed,
   never guessed. The Default deck is refused, since AnkiWeb will not share it.
2. **Read the form.** `deck-share-info` gives what the form is pre-filled with
   and how many shares the account made in the last seven days. A deck that
   carries a `shared_id` is already shared: the call stops and gives its link.
   Sharing it again would update that listing, which this tool does not do yet;
   the refusal points at `unshare_deck` for removing it.
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

## Removing a listing

1. **Read the user's listings.** `list-mine` is read afresh on every call.
   `listing` is a shared id, an `ankiweb.net/shared/info/<id>` link, or an exact
   title, as `list_my_shared_decks` gives them. A title two listings share is
   refused with both ids. An id that is not among the user's own is refused
   too, and that check is the only thing that keeps the tool from asking
   AnkiWeb to remove someone else's listing: `remove-item` answers an empty
   `200` either way.
2. **Without `confirm`,** the call returns `status: "preview"` with the
   listing's title, link, downloads and ratings. Its text starts "Preview only:
   nothing was removed." and says what removal does: the listing goes with its
   ratings and reviews, its link then answers as if it never existed, AnkiWeb
   cannot restore it, and the deck stays in the collection. Nothing is posted
   past `list-mine`.
3. **With `confirm: true`,** step 1 runs again from scratch, then
   `remove-item` is posted and `list-mine` read once more. The call returns
   `status: "removed"` only once the id is gone from it; still listed is an
   error. A listing removed between the two calls is refused by the re-run of
   step 1, since AnkiWeb's answer to the removal says nothing either way.

A listing outlives its deck, so a listing whose deck was deleted is removed the
same way: nothing here reads the deck list.

## Several accounts

With more than one account stored, the preview carries `account`, its text
starts the listing with `Account: <name>`, and the go-ahead it asks for is
`confirm: true` with that `account`. A confirmed call that leaves `account` out
is then refused: a default the user never saw named is no ground to publish
from, or to remove from. With one account, none of this shows. Both tools
follow this rule alike.

## Annotations

`share_deck` is annotated `destructiveHint: false` and `idempotentHint: false`,
and `unshare_deck` `destructiveHint: true` and `idempotentHint: true`; both are
`openWorldHint: true`. Each description tells the assistant to show the
preview to the user and get their go-ahead before confirming.
