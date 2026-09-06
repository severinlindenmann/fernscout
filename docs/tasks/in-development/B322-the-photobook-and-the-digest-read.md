---
id: B322
title: The photobook and the digest read only published days, and nobody has said whether that is a decision
type: CHORE
priority: low
complexity: low
area: photobook, digest
found: "2026-09-04T17:05:32Z"
started: "2026-09-06T14:20:17Z"
session: 6b9bf0a6-5ea8-4f27-bfcd-df5022696053
claimed: "2026-09-06T14:20:17Z"
---

# B322 — The photobook and the digest read only published days, and nobody has said whether that is a decision

## Why

Noticed while fixing B318, and deliberately left alone there.

`lib/photobook/source.ts` and `lib/digest/content.ts` both call
`getDays(tripId)` with no `ReadOptions`, so both see published days only.
That is almost certainly right — a digest mailed to readers must not carry
unpublished writing, and a photobook is a public artefact — but it is right by
*omission* rather than by decision, which is the same shape as the two bugs
that came before it.

The pattern is worth stating, since B318 was the third instance in one day:

- **B296** — the days listing hid drafts from the caller entitled to see them.
- **B318** — both gallery pages never asked who was looking, so an owner saw
  only their published photographs.
- Both were a missing `includeDrafts` at one call site out of nineteen, and
  both were found by *enumerating* callers rather than reasoning about them.

So the question here is narrow and answerable: **is there an owner-facing
preview path either of these should have?** An owner who wants to see what a
photobook of their trip would look like before ordering it, drafts included,
has a reasonable request — and if that is wanted, this is where it lands.

## Work

Decide, and write the answer into both files as a comment either way — the
value of this task is that the next person reading `getDays(tripId)` there
knows it was considered.

- If drafts should stay out: say so, and say why (a digest goes to readers, a
  photobook goes to a printer), so nobody "fixes" it into a leak later.
- If an owner-facing preview is wanted: it is `{ includeDrafts: true }` behind
  the owner's own gate, the same pattern `lib/plan.ts` and `lib/deletions.ts`
  already use, and it needs a test that the *mailed* digest and the *ordered*
  photobook still see only published days.

Note that `postcards` and `photobook` are both off on this instance
(`/api/health`), so nothing here is urgent — and that is also why it would go
unnoticed if it were wrong.

## Acceptance

Both call sites carry a comment saying whether drafts belong there and why,
and if a preview path was added, a test proves the delivered artefact still
excludes drafts.

## Decision (2026-09-06)

**Drafts stay out of both.** A digest goes to readers and a photobook goes to
a printer; neither may carry writing nobody has agreed to publish yet. No
owner-preview path was built.

`lib/photobook/source.ts:365` (`buildBookSource`'s `getDays(tripId)`, the call
this task named) now carries a comment recording that decision. It is the only
place in the photobook feature that reads days for the artefact actually
mailed and printed — `grep -rn buildBookSource` shows its only callers are
`lib/photobook/build.ts`, `lib/photobook/plan.ts` and `scripts/photobook.ts`,
none of them owner-preview code — so drafts cannot reach a delivered book
through it.

**The preview half already exists, separately, and was not missing.**
`app/[user]/trips/[trip]/photobook/page.tsx` and its `(trip)/` twin are the
owner-only composer this task wondered whether to build: both call
`getDays(trip.ref, { includeDrafts: true })` already, behind `mayReadTrip`, to
choose which days and photographs go into the book *before* it is built. That
route is untouched by this ticket — it was already right, by the same "an
owner reading their own trip sees drafts" pattern `lib/plan.ts` uses, and B318
was about gallery pages missing exactly this.

**`lib/digest/content.ts` no longer calls `getDays` at all**, so the second
half of this ticket's premise is stale. B387 deleted the weekly digest that
`getDays` fed; what is left in `lib/digest/content.ts`
(`formatDigestDate`, `dayUrl`) is pure date/URL formatting with no read of any
kind. The single-day mail that replaced the weekly one
(`lib/digest/dayLetter.ts`) reads one entry by slug
(`getEntryBySlug`), which is a different question with its own gate
(`mayMailTrip`) and out of scope here. No comment was added to
`lib/digest/content.ts` because there is no `getDays(tripId)` call left in it
to annotate — adding one to a file it does not touch would be inventing a call
site to satisfy the ticket's shape rather than answering it.
