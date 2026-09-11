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

The currency hint is above with no comment, and I wrote here that it had no such
constraint and could move below. **That was wrong**, and the build caught it.
`lib/journals.ts:860-867` documents `baseCurrency` as the field that *"reads
like a display setting and is not"* — a cost written without a currency **is** a
cost in the base currency, so changing it silently changes what every bare amount
ever written meant. It is *"safe exactly once, when the journal is created"*.

So currency is in the same class as the address: permanent, and a hint that must
be read before typing. It stays above too, and gets the same banded treatment.

(The same sentence is on `/<user>/me` in front of anybody who looks — *"Set once,
when this journal was created… Ask for a new journal if it was wrong from the
start."* — so this was a decision made against evidence that was already to
hand.)
