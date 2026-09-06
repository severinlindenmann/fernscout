---
id: B623
title: The owner block opens on a form and two paragraphs of explanation nobody rereads
type: FEATURE
priority: medium
complexity: low
area: me page
found: "2026-09-06T17:50:30Z"
started: "2026-09-06T17:50:49Z"
session: 46b8aec7-0279-4118-8632-da0af1a52ced
claimed: "2026-09-06T17:50:49Z"
---

# B623 — The owner block opens on a form and two paragraphs of explanation nobody rereads

## Why

`/{user}/me` is the page an owner opens to *do* something — hand over a key,
check a balance, see who is waiting. Two things on it take the room a person
scans past, every visit, forever:

**The journal card (B619) is a form, always open.** Two text boxes, a Save
button and the email block with its three-line explanation, whether or not
anybody came to rename the journal — which is a thing done once and then not
again for a year. The trip pencil beside it, from B621, is the shape that was
wanted: the name is what you read, and the form is what appears when you say
you want it.

**The agent card carries two paragraphs of prose above the list of live
keys.** They are the right words — what a key can do, and that reading in a
browser is not the same as holding one — and they earn their place the first
time somebody hands a key over. They do not earn it the fiftieth, and they sit
between the button and the keys the owner actually came to revoke.

## Work

`<details>`/`<summary>`, both times, which is what the details form on this
page already uses and needs no state.

- **The journal card** collapses to the name it is about, with a pencil
  beside it. Open, it is the form exactly as it is now — the two fields, the
  Save, and the email block below them, which goes with the form rather than
  staying out where it is read every time.
- **The agent card's two paragraphs** go behind one summary. The button that
  mints a key stays where it is, and so does the list of live keys with its
  own line of explanation: that list is actionable — `Sperren` is on it — and
  a control hidden behind a disclosure is a control nobody finds.

**Not doing:** collapsing the payment card or the invite card, and nothing
about what any of this says. This is furniture only.

## Acceptance

- The owner block on `/{user}/me` shows the journal's name and a pencil, not
  two text boxes; pressing the pencil gives the form, and saving still
  renames the journal.
- The agent card shows the handover button, one summary, and the keys — the
  two paragraphs only when the summary is opened.
- Every key those two sections use is still reachable; nothing is orphaned in
  the locale files.
