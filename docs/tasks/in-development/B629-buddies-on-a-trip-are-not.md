---
id: B629
title: Buddies on a trip are not offered in the postcard signature
type: ISSUE
priority: medium
complexity: low
area: postcards, buddies
found: "2026-09-06T17:51:44Z"
started: "2026-09-06T17:55:54Z"
session: e5f23c58-bb87-4175-ad7b-5d3aed93169f
claimed: "2026-09-06T17:55:54Z"
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

## Work

Not done — see the premise check above. If a picker offering trip people
(owner-first, buddies included, via `peopleOf()`) is wanted for the postcard
signature, that is a new capture, not this ticket.

## Acceptance

- A person who joined a trip through a buddy link appears among the people
  offerable in a postcard signature. — N/A: there is no such offering
  mechanism today.
- A trip with no buddies signs exactly as it does now. — true and unaffected;
  no code was changed.
