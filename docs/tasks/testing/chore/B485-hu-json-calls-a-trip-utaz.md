---
id: B485
title: hu.json calls a trip utazás where the guides and B449 settled on út
type: CHORE
priority: medium
complexity: medium
area: i18n
found: "2026-09-05T15:27:05Z"
started: "2026-09-05T15:33:12Z"
merged: "2026-09-05T15:47:38Z"
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

## What changed

Thirty strings, `content/locales/hu.json` only. Nothing in `en.json`,
`de.json` or `docs/guides/`. No key added, removed or reordered; no
interpolation variable touched or suffixed.

**The suffix rules used.** `út` shortens its vowel before the suffixes that
begin with a vowel — `utat`, `utak`, `utakat`, `utad`, `utunk` — and stays long
before the ones that begin with a consonant — `úton`, `útnál`, `útról`,
`úthoz`, `útnak`, `útként`. All of them are back-vowel, so harmony picks
`-nál`, `-tól`, `-ra`, `-nak`, `-ban`. Every form below already occurs
elsewhere in this file as a trip: `utat` (`trips.emptyOwnerBody`), `utad`
(`trips.emptyOwnerFilteredBody`), `utak` (`trips.hiddenBody`), `útnál`
(`photobook.building`), `út` (`trips.lifetimeTrips`, `cost.title`). Nothing
here is a form the file had not already committed to.

Neither the article nor any verb's conjugation moves: `utazás` and `út` both
begin with a vowel, so `az` stays `az`, and every converted object keeps the
determiner it had (`ezt az utazást` → `ezt az utat`), so the definite
conjugation of the verb governing it is unchanged.

| Key | Before | After | Rule |
| --- | --- | --- | --- |
| `contact.adminInviteTrip` | `{trip} utazás` | `{trip} út` | nominative; `{trip}` stays uninflected (B289) |
| `contact.adminNoGuestTrip` | `egyik utazásod sincs` | `egyik utad sincs` | 2sg possessive: `utazásod` → `utad`, vowel shortens |
| `contact.adminNoGuestTrip` | `hogy egy utazás láthatóságát` | `hogy egy út láthatóságát` | nominative possessor of `láthatóságát` |
| `del.doneTripTitle` | `Az utazás törölve lett` | `Az út törölve lett` | nominative subject |
| `del.export` | `a privát utazásokat` | `a privát utakat` | plural accusative: `utak` + `-at` |
| `del.goneTripBody` | `„{title}” utazást` | `„{title}” utat` | accusative; the suffix sits on the noun, never on `{title}` |
| `del.goneTripTitle` | `Ezt az utazást törölték` | `Ezt az utat törölték` | accusative, definite object unchanged |
| `del.journalWhatGoes` | `{trips} utazás, {days} nap` | `{trips} út, {days} nap` | counted noun stays singular in Hungarian |
| `del.tripIntro` | `törölje a(z) „{title}” utazást` | `… „{title}” utat` | accusative |
| `del.tripSubject` | `Törlöd a(z) „{title}” utazást?` | `… „{title}” utat?` | accusative |
| `del.tripTitle` | `ezt az utazást` | `ezt az utat` | accusative |
| `del.tripWhatGoes` | `az utazás fényképeivel` | `az út fényképeivel` | nominative possessor |
| `del.tripWhatGoes` | `egy utazás törlésekor` | `egy út törlésekor` | nominative possessor of `törlésekor` |
| `err.allTrips` | `Az összes utazás` | `Az összes út` | nominative after `összes`; matches `trips.allTrips` |
| `err.tripGoneBody` | `A többi utazás mind` | `A többi út mind` | nominative |
| `err.tripGoneTitle` | `Ez az utazás már nincs itt` | `Ez az út már nincs itt` | nominative |
| `gallery.description` | `Az utazás összes fényképe` | `Az út összes fényképe` | nominative possessor |
| `gate.askOwner` | `Ez az utazás nem nyilvános` | `Ez az út nem nyilvános` | nominative |
| `gate.privateBody` | `Ez az utazás mindenki elől` | `Ez az út mindenki elől` | nominative; `az utazókat` in the same string left alone |
| `gate.privateTitle` | `Ez az utazás csak az utazóké` | `Ez az út csak az utazóké` | nominative; `utazóké` is the travellers, left alone |
| `gate.refusedBody` | `ezt az utazást nem osztották meg` | `ezt az utat nem osztották meg` | accusative |
| `gate.refusedTitle` | `Ezt az utazást nem osztották meg veled` | `Ezt az utat …` | accusative |
| `gate.signInBody` | `Ez az utazás nem nyilvános` | `Ez az út nem nyilvános` | nominative |
| `hero.over` | `Az utazás véget ért` | `Az út véget ért` | nominative |
| `landing.trips` | `{count} utazás` | `{count} út` | counted noun stays singular |
| `landing.trips.one` | `{count} utazás` | `{count} út` | as above |
| `show.cutFull` | `Teljes utazás` | `Teljes út` | nominative ("Full tour") |
| `trips.malformedTitle` | `Néhány utazás nem jelenik meg` | `Néhány út nem jelenik meg` | nominative after `néhány`, singular |
| `trips.malformedTitle.one` | `Egy utazás nem jelenik meg` | `Egy út nem jelenik meg` | nominative |
| `welcome.linkNote` | `a privát utazásokat is látod` | `a privát utakat is látod` | plural accusative |
| `welcome.private` | `egy adott utazás olvasható-e` | `egy adott út olvasható-e` | nominative subject |
| `welcome.private` | `magánál az utazásnál` | `magánál az útnál` | adessive `-nál`, back harmony, vowel stays long — the form `photobook.building` already uses |
| `welcome.private` | `egy új utazás … vendég-utazásként indul` | `egy új út … vendég útként indul` | nominative + essive `-ként`, consonant-initial so the vowel stays long. Written as two words to match the same string's own `(vendég napló)`, which drops the hyphen the old compound carried |
| `welcome.public` | `Minden utazás továbbra is` | `Minden út továbbra is` | nominative after `minden`, singular |
| `welcome.public` | `egy új utazás itt is nyilvánosan indul` | `egy új út itt is nyilvánosan indul` | nominative |

## Left alone, and why

Every remaining `utaz*` in the file, read in context:

| Key | Text | Sense |
| --- | --- | --- |
| `gate.privateBody` | `az utazókat kivéve` | **the travellers** — the people, not the trip |
| `gate.privateTitle` | `csak az utazóké` | **the travellers'** — possessive of the people |
| `photobook.option.names` | `Kik utaztak` | **verb**, "who travelled" |
| `cost.budgetTotal` | `Utazási keret` | **adjectival** `utazási`, "travel budget"; `útikeret` is not a word and `út` has no adjective that fits here |

There is no surviving `utazás` in the file at all — not because the abstract
sense was converted, but because the file never had one. Every occurrence was
a named journey. `útmutató`, `útinapló`, `útvonal`, `útitárs`, `útközben` and
`visszaút` are separate words and were not touched.

**One thing found and not fixed here:** `me.paymentPrices` says `útitól`
where the ablative of `út` is `úttól` — `úti` is the adjective, and it cannot
take that suffix. It is a different defect from the one this ticket is about,
so it is **B489** rather than scope absorbed on the way past.

## No test, and what to check instead

The Work section already said no test, and the sweep confirmed why. The only
mechanical check available is "no value contains the stem `utazás`", which is
true today only because this file happens to have no abstract-travel string —
the moment somebody writes one (`Az utazás megváltoztat`) the assertion fails
on correct Hungarian. That is a test that pins taste and then punishes the
next author for having some. Grammatical forms cannot be asserted either
without a morphological analyser this repository has no reason to carry.

Manual acceptance, in place of it:

- `grep -c utaz content/locales/hu.json` is **3**, and `grep -ci utaz` is
  **4**; the four survivors are the table above.
- Hungarian gate page on a private trip: heading *Ez az út csak az utazóké*,
  body *Ez az út mindenki elől zárva van, az utazókat kivéve*.
- Hungarian landing page: the trip count reads *{n} út*.
- Hungarian trip-delete confirmation: *Tényleg törölni akarod ezt az utat?*
- Moving between `docs/guides/hu/*.md` and the interface, a trip is `út` in
  both.

## Acceptance

- `grep -c 'utazás' content/locales/hu.json` returns only the abstract-sense
  strings listed above, and each survivor is defensible in one sentence.
- `npm run verify` passes.
- Spot-check the gate pages and the landing page in Hungarian: one word for a
  trip, and it is the same word the reader guides use.
