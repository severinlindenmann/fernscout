---
id: B1451
title: The printer's status is shown as a raw English API word instead of a readable state
type: FEATURE
priority: medium
complexity: low
area: photobook, design, i18n
found: "2026-09-11T11:56:02Z"
started: "2026-09-11T11:56:33Z"
merged: "2026-09-11T12:10:28Z"
---

# B1451 — The printer's status is shown as a raw English API word instead of a readable state

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`/<user>/photobooks/<id>` renders, in a German journal:

> **Drucken**
> Status bei der Druckerei: created.

`created` is Gelato's own API token, in English, inside an otherwise German
page. A reader has to know a third party's vocabulary to learn whether their
book is fine. The three states a person actually cares about — it is coming,
it is being made, something went wrong — are all flattened into the same grey
sentence, so the page reads identically whether the order is healthy or dead.

## The constraint that matters more than the styling

The page's own comment explains why it prints the raw word today:

> **Gelato's sandbox reports `Cancelled` for every order it accepts.** That is
> not a failure and this page does not treat it as one: it prints whatever
> Gelato says, unexplained, because the honest state of an order this server
> does not run in production is whatever the printer says it is.

That was written for the sandbox. The instance is live now, so the statuses
are real and translating them is fair. **But the rule behind that comment must
survive**: a word we have not mapped must not be given a meaning or a colour
it has not earned. Gelato can add a status tomorrow, and colouring an unknown
one green or red would be inventing a fact about somebody's book.

So: known words get a translated label and a colour; **anything else shows the
raw word, neutral, untranslated**, exactly as today. Update that comment to say
this rather than leaving it describing behaviour that has changed.

## Work

A small status pill beside the heading — a filled dot or chip and a label —
replacing the sentence.

**The vocabulary, from what the code already knows** (`TERMINAL_FAILURES` in
`print.ts:175`, the webhook's own list, and `fulfillmentStatus` observed live):

| Gelato says | Means | Colour |
| --- | --- | --- |
| `created`, `passed` | accepted, waiting to be made | navy — neutral, nothing is wrong |
| `in_production`, `printed` | being made | amber |
| `shipped` | posted | green |
| `failed`, `canceled`, `cancelled` | refused | coral |
| anything else | unknown — print the raw word | navy, no claim |

**Colours come from `app/globals.css` and nowhere else** — read
`apply-the-brand` first. There is no orange in this palette; the nearest and
correct choice for "being made" is `yellow-600` (`#d69b0a`), which is the
deep amber the brand already uses for accents that must carry text contrast.
Do not introduce a new hue for this. Green is `green-700`, coral is
`coral-600`, neutral is `navy-600` — all of them already chosen to be legible
on cream.

Also:
- Real English and German labels. `hu` may carry English with a note in this
  file, as B1438 and B1440 did — the `photobook.*` block already needs one
  native pass and this adds to it rather than starting a new debt.
- The pill states its meaning in the label, not only in the colour. Colour
  alone fails a reader who cannot distinguish it, and the existing palette
  notes are explicit that readers here are often on a phone outdoors.
- `printed` as a Gelato word means the printer has printed it. Do not confuse
  it with the order-status column, which B1437 renamed to `built` for exactly
  this reason.

**Not in this ticket.** No change to what the webhook does, to refunds, or to
the tracking rows B1440 added below the status.

## Acceptance

- A German journal shows a German label, not `created`.
- A refused order's pill is coral; a shipped one green; one being made amber;
  an accepted one neutral.
- An unrecognised status still shows the raw word with no colour claim.
- Looked at in a browser at 390px, not judged from the source — the pill is
  drawn, so `check-a-drawing` applies.
- `npm run verify` clean.

## Note

`hu` carries English for the five new keys this ticket added
(`photobook.print.status.unknown`, `.accepted`, `.inProduction`, `.shipped`,
`.refused`) — no native Hungarian pass, same debt B1438 and B1440 already
left on the rest of the `photobook.*` block. A native speaker should do one
pass over the whole block rather than one ticket at a time.
