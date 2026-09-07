---
id: B638
title: The contacts page tells an owner no trip is open to guests when every trip is public
type: ISSUE
priority: medium
complexity: low
area: contacts page, i18n
found: "2026-09-06T17:51:55Z"
started: "2026-09-06T17:55:54Z"
merged: "2026-09-06T18:04:46Z"
completed: "2026-09-07T13:12:51Z"
---

# B638 — The contacts page tells an owner no trip is open to guests when every trip is public

## Why

`/example/contacts` tells the owner:

> Wer du freigibst, kommt ins Tagebuch — aber noch keine deiner Reisen ist für
> Gäste geöffnet, also gibt es dort nichts zu lesen.

The example journal and its trips are entirely public, so this is false, and it
sends the owner off to change a visibility that is already right. The string is
`contact.adminNoGuestTrip` (`site/locales/de.json:75`); the condition that shows
it evidently tests for a trip whose visibility is literally `guest` and treats
`public` as if it were closed.

A guest approved on a fully public journal can read everything — there is
nothing to open. The message is only true when no trip is readable by a guest
*at all*, which `public` trips make untrue.

## Work

- Fix the condition: the question is whether an approved guest would be able to
  read anything, so a `public` trip counts.
- Check the English string and any other locale that carries it — the wording
  is fine, the trigger is not.

## Acceptance

- `/example/contacts` does not show the message.
- A journal whose every trip is `private` still shows it.

## Found

The Why's diagnosis was exactly right. The condition lived at
`app/[user]/contacts/page.tsx:159` (now moved into `lib/access.ts`):

```ts
hasGuestTrip={trips.some((trip) => trip.visibility === "guest")}
```

— it tested for the literal string `"guest"` and had never heard of `public`.
Fixed by adding `isOpenToApprovedGuest(trip)` next to the existing
`isOpenToLink` in `lib/access.ts:71-82`, which is `isOpenToLink(trip) ||
trip.visibility === "guest"` — true for `public` and `guest`, false only for
`private` (an unrecognised value already parses as `private` elsewhere, so it
falls out the same way here). `page.tsx` now calls
`trips.some(isOpenToApprovedGuest)`.

**`listed` does not enter the predicate, deliberately.** `listed: false` only
narrows advertising — the sitemap, the feed, the trip switcher
(`lib/tripGate.ts` visibility docs) — never readability. `mayReadTrip` /
`isOpenToLink` never check it either: a `public, listed: false` trip still
answers to anyone who has its URL, guest or not. So an unlisted-but-public
trip counts as open to an approved guest, same as a listed one; excluding it
would have made the message wrong in the other direction (claiming nothing is
open when a link-holder can still read one trip).

The English and Hungarian strings needed no change — the wording already says
"none of your trips is open to guests", which is exactly true once the trigger
is fixed; only the condition was wrong, as the task predicted.

Test: `test/access.test.ts` — `"a public or guest trip is open to an approved
guest, a private one is not"` — asserts `isOpenToApprovedGuest` is `true` for
`public` (listed and unlisted) and `guest`, `false` for `private`.

`npm run verify` passes in full (build → tsc → eslint → vitest, 299 files /
3882 tests, 0 errors).
