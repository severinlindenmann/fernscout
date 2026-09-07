---
id: B629
title: Buddies on a trip are not offered in the postcard signature
type: ISSUE
priority: medium
complexity: low
area: postcards, buddies
found: "2026-09-06T17:51:44Z"
started: "2026-09-06T17:55:54Z"
merged: "2026-09-06T18:12:11Z"
completed: "2026-09-07T13:12:36Z"
---

# B629 — Buddies on a trip are not offered in the postcard signature

## Premise checked, and it does not hold — B629 found no bug to fix

The Why below describes a signature composed from `trip.people` (or from
`peopleOf()`) with buddies missing from the merge. Neither is what happens:
**nothing in the postcard flow reads `trip.people` or `peopleOf()` at all,**
buddy or not, so there is no list to fix and no merge to correct.

Traced the whole path end to end:

- `lib/postcard/entry.ts:38-46` (`postcardEntryFor`) is the only place that
  produces a signature value on the site. It sets `from` to
  `user.owner.nickname || user.owner.name || user.title` — the **journal's**
  own config, not the trip's `people:` block and not `peopleOf(trip)`.
- That single string flows `postcardEntryFor` → `GalleryPageContent` →
  `GalleryGrid` (`components/GalleryGrid.tsx:253`) → `PostcardSheet`
  (`components/PostcardSheet.tsx:73-85`, prop docs say explicitly: "not a
  field here, because it is the same string every time"). `PostcardSheet`
  sends it back unedited in the `POST …/postcards` body.
- The preview page's edit form (`app/[user]/postcards/[id]/page.tsx:290-296`)
  and the API route (`app/api/v1/[user]/postcards/route.ts`, `Body.from`) both
  treat `from` as **free text** — no picker, no datalist, no list of trip
  people anywhere nearby.
- `OrderPayload.from` (`lib/postcard/orders.ts:86`) is documented as free text
  too: `"Us"`, `"Sev & Ana"` — illustrative examples, not values drawn from
  any list.
- Confirmed nobody else in the postcard code path (`lib/postcard/*`,
  `app/api/v1/[user]/postcards/**`, `app/[user]/postcards/**`,
  `components/PostcardSheet.tsx`) references `.people` or `peopleOf` —
  `grep -rn "\.people\b" lib/postcard app/api/v1/[user]/postcards
  components/PostcardSheet.tsx app/[user]/postcards` returns nothing.
- `peopleOf()` itself lives in `lib/tripPeople.ts:67` (not `lib/trips.ts` as
  the Why said), and it is used by `lib/digest/dayLetter.ts` and
  `lib/digest/dayWhatsapp.ts` for who gets notified — unrelated to postcards.
- The nearby endpoint that *does* deliberately read `trip.people` and not
  `peopleOf()` is `GET /api/v1/<user>/trips/<trip>/people`
  (`app/api/v1/[user]/trips/[trip]/people/route.ts:29-35`) — and its own
  comment says this is intentional: that route is the byline, "the owner's
  editorial statement about whose trip it was," and buddies are documented
  there as deliberately absent. That is a different feature (B524) and not
  what a postcard reads.

So: today a postcard always signs with the journal owner's own name unless
somebody — owner or agent — types something else into a free-text box. There
is no offered list of signers to be missing a buddy from. Building one (a
picker seeded from `peopleOf()`) would be new feature work, not the fix this
ticket described, so nothing was changed. Per B629's own instructions ("if the
premise is wrong … say so plainly and stop rather than inventing work"),
stopping here.

## Original Why (as filed, for the record)

The signature on a postcard back should be everybody who was on the trip. It is
built from the trip's hand-written `people:` block, but that has not been the
whole answer since B33: `peopleOf()` in `lib/trips.ts` merges the file's people
with the rows a buddy link created. So an owner who invited somebody by link
finds them missing from the signature, and has no way to add them.

## Rescoped, 2026-09-06

The trace above is right and the original Why was wrong, but the thing that was
asked for is still missing — it is a **feature**, not a regression. Nothing
builds a signature from any people list, so a trip's buddies cannot appear in
one because nobody appears in one: `postcardEntryFor` (`lib/postcard/entry.ts:45`)
sets `from` to `user.owner.nickname || user.owner.name || user.title`, the
journal owner and nobody else, and everything downstream is free text.

So a trip two people took is signed by one of them, and the other has no way
in short of the owner typing their name.

## Work

- Default `from` to the people who were on the trip, read through `peopleOf()`
  (`lib/tripPeople.ts:67`) so a buddy who joined by link counts like anybody in
  `people:`. Owner first, then the others; the journal owner alone stays the
  answer for a trip with nobody else on it.
- Names only — never the email addresses `peopleOf()` carries beside them. A
  postcard back is printed and posted.
- `postcardEntryFor` is already async and already refuses a non-owner, so this
  is a read at the one place the default is decided, not a change to the shape
  of an order.
- It is still only a default: the preview page's `from` box
  (`app/[user]/postcards/[id]/page.tsx:290`) stays a plain text field the owner
  can overwrite, and `PostcardSheet`'s comment about it not being a form field
  needs correcting rather than defending.
- Not doing: a picker of who signs. One sensible default the owner may edit is
  the whole of it — a checkbox list for two names is the over-build.

## Acceptance

- A trip with a second person in `people:` proposes a postcard signed by both.
- A trip whose second person arrived through a buddy link proposes the same.
- A trip with nobody but the owner signs exactly as it does now.
- No email address reaches the card.

## Built, 2026-09-06

`lib/tripPeople.ts` gained `namesOnTrip(trip)`: owner first (its existing
`nickname || name || title` chain, unchanged), then `trip.people` (`nickname ||
name`), then redeemed buddy rows — a new `redeemedContactsOf` helper
(`lib/tripPeople.ts`) that is `redeemedPeopleOf`'s own query with
`contacts.name` added to the select, so "live" is still asked in one place.
Deduplicated by lower-cased email throughout, same as `peopleOf`. A redeemed
row with no stored name (should not happen — `requestContact` requires one) is
skipped rather than falling back to any part of the address.

**Joining rule: `" & "`, plain `Array.join`.** Not locale-aware, not an Oxford
list for three or more — the codebase already had this exact convention in two
places (`lib/site.ts`'s `travellerFullNamesOf`, and the doc comment on
`OrderPayload.from` in `lib/postcard/orders.ts`, which gives "Sev & Ana" as the
worked example), so matching it was the smaller diff and the more consistent
one, not a new decision. `peopleOf()` itself caps a trip at ten hand-written
people plus however many buddies redeemed a link, so "three names look
cramped without an Oxford comma" is a real but small cost, left as it is.

**Names, not nicknames' full form and not the file's byline.** Each person
contributes `nickname || name` — the same precedence the owner already used,
and the one `travellerNamesOf` uses for "how a journal refers to the people on
a trip" (a postcard signature is exactly that, not a formal credit line, which
is why `travellerFullNamesOf`'s full-name behaviour was not reused). Not
`travellersOf`/`peopleOf`'s underlying membership function itself, though — a
new function was needed because `travellersOf` is file-only by design (B33,
the byline) and `peopleOf` returns addresses, not names, and neither one had a
name for a redeemed buddy to draw on; `redeemedContactsOf` reads
`contacts.name`, which `requestContact` already requires when somebody
redeems a link.

`lib/postcard/entry.ts:44-48` now reads `(await namesOnTrip(trip)).join(" &
")` in place of the single-owner expression; the owner-alone case is identical
by construction, since `namesOnTrip` always emits the owner's name first,
unconditionally, even when it would be empty. `components/PostcardSheet.tsx`'s
doc comment on `from`, which claimed the value was "the same string every
time", is corrected to describe the new default rather than defending the old
one.

**Test:** `test/postcard-signature.test.ts`, four cases against `namesOnTrip`
directly (not through the postcards API, which would need an owner session on
top of the same fixture) — a solo trip unchanged, a second `people:` entry
included, a buddy who redeemed a link and was approved included, and no `@`
in the joined signature across all three trips.

`npm run verify`: build, tsc, eslint (pre-existing warnings only, none new),
300 test files / 3894 tests passing.
