---
id: B485
title: hu.json calls a trip utazás where the guides and B449 settled on út
type: CHORE
priority: medium
complexity: medium
area: i18n
found: "2026-09-05T15:27:05Z"
---

# B485 — hu.json calls a trip utazás where the guides and B449 settled on út

## Why

B449 settled the vocabulary question its own item 7 raised: **a trip is `út`,
and `utazás` survives only where the text means travel in the abstract rather
than one named journey.** The decision was the owner's, taken because all three
Hungarian reader guides already said `út` everywhere, so it was both the
smaller diff and the idiomatic noun for a named journey.

`content/locales/hu.json` does not follow it. Roughly thirty strings call a
trip an `utazás` — `gate.privateTitle` ("Ez az utazás csak az utazóké"),
`gate.askOwner`, `gate.refusedTitle`, `err.tripGoneTitle`, `del.tripTitle`,
`del.tripWhatGoes`, `landing.trips`, `hero.over`, `show.cutFull`,
`trips.malformedTitle`, `welcome.private`, `welcome.public`,
`contact.adminInviteTrip` and more — while `me.buddyAgent` and the guides say
`út`. A reader who moves between a guide and the interface meets two words for
one thing, and B481's sibling work on the same file will otherwise entrench the
split.

This was not fixed in B449's branch on purpose: `hu.json` was being edited on a
parallel branch (B481) at the time, and two branches rewriting one locale file
is a merge nobody wants.

## Work

- Go through `content/locales/hu.json` and replace `utazás` with `út` wherever
  the string means one specific trip, with the case suffix corrected for each
  site (`utazást` → `utat`, `utazásod` → `utad`, `az utazásnál` → `az útnál`,
  and so on — this is not a search-and-replace).
- Leave `utazás`/`utazik` where the sense really is travelling in the abstract
  or the people travelling (`gate.privateTitle`'s "az utazóké",
  `photobook.option.names` "Kik utaztak") — those are not the noun for a trip.
- Check the plural and the counted forms: `landing.trips` is `{count} utazás`
  and becomes `{count} út`.
- Not doing: any change to the German or English locales, and no new test. The
  vocabulary is prose, and pinning one word in a test would be pinning taste.

## Acceptance

- `grep -c 'utazás' content/locales/hu.json` returns only the abstract-sense
  strings listed above, and each survivor is defensible in one sentence.
- `npm run verify` passes.
- Spot-check the gate pages and the landing page in Hungarian: one word for a
  trip, and it is the same word the reader guides use.
