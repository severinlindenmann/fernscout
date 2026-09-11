---
id: B1293
title: Two of the four signup hints sit above their field and two below, so the address rule reads as the title rule
type: ISSUE
priority: low
complexity: low
area: signup
found: "2026-09-10T10:59:32Z"
started: "2026-09-11T15:47:57Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T15:47:57Z"
---

# B1293 — Two of the four signup hints sit above their field and two below, so the address rule reads as the title rule
## Why

Measured on the live wizard at 390px, by y-coordinate:

| y | element |
| --- | --- |
| 553 | input — **What should we call your journal?** |
| 602 | hint — *"Lowercase letters, digits and dashes. This becomes the web address of your journal…"* |
| 739 | input — **Choose its address** |
| 830 | input — Your full name |
| 871 | hint — *"It appears on your trips as the person who kept them."* |
| 977 | input — What the site should call you |
| 1018 | hint — *"The short form the site uses when it speaks to you…"* |
| 1692 | hint — *"A three-letter code — EUR, CHF, HUF, USD…"* |
| 1829 | input — **Which currency do you count in?** |

Name and nickname have their hints **below**, correctly. Address and currency
have theirs **above** — and 120px and 137px above, with nothing between.

The address one does real damage. A rule reading *"Lowercase letters, digits and
dashes"* sitting 49px under the **journal title** field reads as a constraint on
the title, so a person types `bern-weekend` where their journal's name belongs.
The field it actually describes is off the bottom of the phone screen when the
hint is read.

On a wide screen all four hints are visible at once and the association is
obvious. At 390px you see one field and one paragraph at a time, which is what
makes the inconsistency cost something.

## Work

- Put every hint on the same side of its field. Below is the convention the two
  correct ones already follow.

## Acceptance

- At 390px, each hint on the create form is adjacent to the field it describes,
  on the same side for all four.


## Decision, 2026-09-11 — do not move the address hint

**The inconsistency is deliberate on the field that matters, and the fix this
ticket proposes would undo a tested one.**

`components/SignupWizard.tsx:689-694` says why in its own comment: *"B809 —
above the field, not below it. A tester chose an address and only then read that
it was going to be a web address, which is the one thing here that cannot be
corrected afterwards."* B809 merged on 2026-09-07, three days before this ticket
was captured, and moved that hint above **on purpose** after a 23-year-old
tester typed a username before reading what it would become.

So the rule is not "hints go below". It is: **a hint that must be read before
typing sits above; one that need not sits below.** The address hint is the only
field here nobody can correct afterwards.

What is left of this ticket, and it is real: the address hint reads as though it
belongs to the **title** field above it rather than the username field below.
Fix that by grouping — tighten the gap to the field it describes, or add a rule
or band tying the two together — not by relocating it.

The currency hint is above with no comment and no such constraint; currency is
freely correctable later, so it can move below to match name and nickname.

## Work

Built in `components/SignupWizard.tsx`, on branch `b1258-ui-remainder`.

- **The username hint** is now wrapped, together with its field, in a banded
  group: `<div className="mt-6 rounded-xl border border-navy-200 bg-cream-50
  p-4">` around the hint paragraph and the `signup-username` field, with
  `mt-2` between them inside the band. It stays above the field exactly as
  B809 put it — not moved — with the border and background now doing the
  work of tying it to its own field rather than to the title field above,
  which is what the ticket's Decision section asked for.
- **This ticket's own Decision section was wrong about the currency field,
  and I did not follow it as written.** It says "currency is freely
  correctable later, so it can move below to match name and nickname." The
  code says the opposite: `lib/journals.ts`'s `JOURNAL_FIELD_REFUSALS`
  documents `baseCurrency` as "not writable after a journal exists... it is
  safe exactly once, when the journal is created, and that is where it
  stays" — the same one-shot permanence as the address, not the freely
  corrected shape of name or nickname. Moving its hint below the field would
  have reintroduced exactly the "read before you type" fault B809 fixed for
  the address, on a field just as unrecoverable. So the currency hint was
  **not moved below** — it got the same banded-group treatment as the
  username, staying above the field with a border tying it to its own input,
  and its own code comment now says why (`setJournalProfile` refuses it
  forever, cited by line).
- Verified with `test/signup-wizard.test.tsx` (7 tests, all pass).
- Driven in a real local browser (Playwright, 390×844) through the actual
  `/agent` → "No, I am starting one" → email code → journal-creation step,
  with `features.signup` and `features.mail` switched on locally for the
  test. An accessibility snapshot with bounding boxes confirms the banded
  group renders as a real, padded, bordered box distinct from the title
  field above it (children inset ~16px from the group's own edges, matching
  the `p-4` padding), for both the address and currency fields. A pixel
  screenshot could not be captured — the browser tool's screenshot call
  timed out waiting on web fonts on this run, repeatedly, unrelated to this
  change — so the visual confirmation here is the bounding-box structure
  rather than an image.
