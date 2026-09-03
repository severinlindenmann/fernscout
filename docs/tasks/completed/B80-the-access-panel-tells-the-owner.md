---
id: B80
title: The access panel tells the owner they were on every trip in their journal
type: ISSUE
priority: medium
complexity: low
area: viewer, me, i18n
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
completed: "2026-09-03T19:55:18Z"
---

# B80 — The access panel tells the owner they were on every trip in their journal

## Why

Under *"Was du lesen kannst"* on `/{user}/me`, every trip carries a line saying
why the reader may open it. For the owner, every one of them reads

> Testreise — du warst auf dieser Reise dabei

whether or not they were. `resolveViewer` (`lib/viewer.ts:70`) collapses the two
cases into one arm:

```ts
if (owner || isPersonOn(trip, email)) {
  visible.push(describe(trip, "traveller", current));
}
```

and `through` only has three values (`lib/viewer.ts:27`), so there is no fourth
one to report. The panel then renders `me.viaTraveller` —
*"du warst auf dieser Reise dabei"* / *"you were on this trip"*
(`content/locales/de.json:339`, `app/[user]/me/MePageContent.tsx:47–51,120`).

Owning a journal and having been on a trip are different facts, and the panel's
whole job is to state the true one. They come apart in the ordinary case: a
journal holds a trip the owner did not travel — somebody else's fortnight
written up in their journal, or a `test: true` trip nobody lived — and the
panel asserts they were there. It is also just wrong on the reading side: the
owner reads that trip because it is theirs, not because they are in `people:`,
and if their address were removed from `people:` tomorrow nothing about their
access would change.

**Confirmed while building, and stronger than the Why first put it.** That last
sentence is not a thought experiment about what `people:` ought to mean: it is
what the code does. `peopleOf` (`lib/tripPeople.ts`) puts the journal owner's
address into the list before it looks at `people:` at all, so `isPersonOn` is
`true` for the owner of every trip in their journal, `people:` empty or not.
The two conditions in the collapsed arm were therefore not merely both-true in
the overlapping case — the second was *always* true whenever the first was, and
the panel could never have said anything but "you were on this trip" to an
owner. It also makes the ordering below load-bearing rather than a matter of
taste: `owner` has to be asked first, because `isPersonOn` would otherwise
answer for it and nothing would change.

The comment directly above the arm says the order "decides which reason the
panel shows, and being on a trip is a better answer than 'you were invited to
it'". That reasoning is right and just stops one case short: being the owner is
a better answer still, and it is the one the code checks first without ever
saying so.

Cosmetic in effect — nothing is leaked and nothing is refused — but this panel
is the one page written for the reader who trusts what it says about access,
and a line that is confidently wrong about who was on a trip is worse there
than anywhere else on the site.

## Work

Add `owner` to `ViewerTrip["through"]` and split the arm, keeping the existing
precedence: owner first, then `isPersonOn`, then public, then guest.

**Decision — the owner who was also on the trip reads the ownership reason.**
Two true things, one line, and the line is the one that answers the question the
panel is asking: *why may I open this?* The answer is that the journal is
theirs. Being on the trip is the warmer fact and the weaker reason — it can be
edited away this afternoon without changing anything about the access, and, as
the Why now records, it is not even independently true: `isPersonOn` counts the
owner whatever `people:` says. Printing "you were on this trip" to an owner
would mean printing a sentence that is sometimes false (the trip they did not
travel) and never load-bearing (the trip they did). So: `owner` wins, and the
distinction the panel draws is ownership versus everybody else's reasons.

The cost of the decision, stated so nobody has to rediscover it: an owner's
panel now reads the same line beside every trip, and the one place the site
could have told them apart — "this one you were actually on" — is not this
panel. If that turns out to be wanted, it is a second line, not a replacement
for this one.

**Decision — the wording.** All three read as "it is in your journal", not "this
is your trip":

| | |
| --- | --- |
| `en` | it is in your journal |
| `de` | sie steht in deinem Tagebuch |
| `hu` | a te naplódban van |

*"das ist deine Reise"* was the suggestion and was dropped: beside a trip title,
"your trip" is read as *a trip of yours*, which is the very implication this
task exists to remove — the `test: true` trip nobody lived is not the owner's
trip in any sense they would recognise, but it is unarguably in their journal.
"In your journal" also names the thing that actually grants the access, which is
what the panel is for. `Besitzer` never appeared: it is gendered, and de.json
avoids gendered nouns throughout — `me.ownerTitle` is already *"Das ist dein
Tagebuch"*, so `Tagebuch` is this page's own word for a journal and the new line
uses it. Hungarian follows `me.ownerTitle` — *"Ez a te naplód"* — for the same
reason.

New copy in all three of `content/locales/{en,de,hu}.json` plus the key union in
`lib/i18n.ts`, which `npm run i18n:keys` regenerates from `en.json`.

`through` is consumed only by the panel (`MePageContent.tsx:47,120`) and by two
tests — checked with `grep -rn "through\b"` across `app`, `lib`, `components`
and `test`, and nothing else reads it — so the union widening is contained.

Not doing: changing who may read anything. `mayReadTrip` is untouched, no arm
is added or removed, and the set of trips listed is exactly the same set — only
the sentence beside them changes. This must not become a second answer to the
access question; B41 and B45 are the record of what happens when the panel
computes its own.

## Acceptance

- An owner who is not in a trip's `people:` is shown an ownership reason, not
  "you were on this trip".
- A traveller who is not the owner still reads "you were on this trip".
- The owner-and-traveller case renders the reason this file records, asserted by
  a test.
- The set of trips `resolveViewer` returns is unchanged for every viewer ×
  visibility pair in `test/access-gate.test.ts`.
- `npm run i18n:keys`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`,
  `npm run build`.

## What it took

- `lib/viewer.ts` — `through` gains `owner`; the one arm becomes two, owner
  first. The comment above it now says why the order is load-bearing.
- `app/[user]/me/MePageContent.tsx` — one entry in the `reason` map. The owner
  block (B79's ground) is untouched.
- `content/locales/{en,de,hu}.json` + `lib/i18n.ts` — `me.viaOwner`.
- `test/access-gate.test.ts` — the owner row of the table reads `owner` five
  times where it read `traveller`. The trips it lists are the same five, and
  `read` is untouched: the set did not move, only the sentence.
- `test/viewer.test.ts` — the mirrored decision follows the real one, plus the
  both-true case; and a new database-backed test signs in as the owner and
  asserts all three trips, including the one she is on `people:` for, read
  `owner`.
- `test/access-panel.test.tsx` — the rendered strings, because the bug was a
  sentence somebody read.

No second problem was captured. Two candidates were checked and neither is one:
a public `test: true` trip is listed by the panel, but `listableTrips` lists it
in the trip switcher and on `/trips` too, so the panel is not an outlier and
on-site listing of test content is the existing design (`isIndexable` guards the
outward surfaces — sitemap, feed, search, landing — and B70 is the digest). And
`test/viewer.test.ts` mirrors the resolver's logic rather than calling it, so it
kept passing while the behaviour changed under it — which is exactly why
`test/access-gate.test.ts` exists (B41, B45) and is recorded in that file's own
header, not a new finding.
