---
id: B80
title: The access panel tells the owner they were on every trip in their journal
type: ISSUE
priority: medium
complexity: low
area: viewer, me, i18n
found: "2026-09-01"
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

One question to settle rather than assume: the owner **who was also on the
trip**. Two true things, one line. Prefer the ownership reason — it is the one
that survives an edit to `people:`, and it is what actually grants the access
the panel is explaining — and write the decision into this file either way.

New copy in all three of `content/locales/{en,de,hu}.json` plus the key union in
`lib/i18n.ts`. German is the phrasing the bug was reported in: *"du bist
Besitzer der Reise"* is the sense, though `Besitzer` is a gendered noun and the
rest of the file is written to avoid that — something closer to *"das ist deine
Reise"* fits the panel's voice and sidesteps it. `npm run i18n:keys` must pass.

`through` is consumed only by the panel today (`MePageContent.tsx:47`), so the
union widening is contained; check that with a grep before assuming it.

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
