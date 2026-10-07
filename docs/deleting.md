# Deleting a deck

`delete_deck` deletes one of the user's decks, with its subdecks and their
cards, from their AnkiWeb collection. Every device picks the deletion up on its
next sync, and AnkiWeb's own page warns "Delete all cards in deck? This can not
be undone." So nothing is deleted unless the call says `confirm: true`, the
confirmed call names the deck by its id, and the tool is left out entirely when
the server runs with `--read-only`.

It talks to the endpoints the deck list uses (see
[ankiweb.md](ankiweb.md#the-users-decks)) through the browser context's request
API, so it needs a session but renders no page.

## Layout

| module                     | does                                                          |
| -------------------------- | ------------------------------------------------------------- |
| `src/ankiweb/decks.ts`     | reads the deck tree, deletes a deck                           |
| `src/ankiweb/share.ts`     | `deck-share-info`, read for each deck's listing               |
| `src/tools/deck-choice.ts` | picks the deck by id or exact name, refusing the Default deck |
| `src/tools/delete-deck.ts` | builds the preview, deletes on confirm                        |

## A call

1. **Pick the deck.** `deck` is an id or an exact full name from
   `list_my_decks`. A name two decks share is refused with both ids listed,
   never guessed. The Default deck is refused: Anki keeps it, so its cards are
   deleted or moved in Anki instead.
2. **Gather what goes.** The subdecks are every deck whose name starts with
   `<name>::`; AnkiWeb deletes them with their parent. The card count is
   `cardsIncludingSubdecks`. A filtered deck's cards go back to their home decks
   rather than being deleted, and the preview says so instead.
3. **Find the listings.** `deck-share-info` is read for the deck and each
   subdeck, one at a time. A listing outlives its deck, and once the deck is
   gone nothing links the two, so each listing found is named in the preview
   with the `unshare_deck` call that removes it.
4. **Without `confirm`,** the call returns `status: "preview"`, and its text
   starts "Preview only: nothing was deleted." It gives the card count, the
   subdecks and the listings, says the deletion reaches every synced device and
   cannot be undone, and asks for `confirm: true` with `deck` set to the id.
   Nothing is posted but reads.
5. **With `confirm: true`,** `deck` must be the numeric id, or the call is
   refused before anything is read. A name can point at another deck after a
   rename between the two calls; reading everything again catches changed
   contents, not that. Then steps 1 to 3 run again from scratch,
   `remove-deck` is posted, and the deck list read once more. The call returns
   `status: "deleted"` only once the id is gone from it; still listed is an
   error. `remove-deck` answers an empty `200` whether or not the deck existed,
   so a deck already gone is caught by the re-run of step 1 rather than by
   AnkiWeb's answer.

## Several accounts

With more than one account stored, the preview carries `account` and the
go-ahead it asks for names it. A confirmed call that leaves `account` out is
refused, as for [`share_deck`](sharing.md#several-accounts).

## Annotations

`destructiveHint: true`, `idempotentHint: true` and `openWorldHint: true`. The
description tells the assistant to show the preview and wait for the user's
explicit go-ahead, and that the confirmed call names the deck by id.
