---
id: B797
title: Nothing in the header leads to the agent, and the signed-in landing repeats the invitation in a block of its own
type: FEATURE
priority: high
complexity: medium
area: header, nav, landing, agent
found: "2026-09-07T17:10:00Z"
started: "2026-09-07T14:57:20Z"
session: ccdd5120-0eb0-4abf-b76e-a6fd8e5005d8
claimed: "2026-09-07T14:57:20Z"
---

# B797 — Nothing in the header leads to the agent, and the signed-in landing repeats the invitation in a block of its own

## Why

Three requests from the owner in one sitting, which turn out to be one change:

1. *"in the menu nav add a button Agent with an icon to the agent page."*
2. *"the Agent must be big, feeling like a call to action to press it"* —
   *"Agent with an icon, written out maybe if the mobile space fits."*
3. *"remove that from the main page and instead add on the main page in the
   header also an Agent and Doc symbol"* — pointing at the signed-in landing's
   "Heutigen Tag schreiben" button, the paragraph under it, the "Schon einen
   eigenen Agenten?" disclosure, and "Dokumentation lesen".

The through-line: **the way in to `/agent` should live in the header, on every
page, rather than as a block on one page.** Today it is the other way round —
the seven-destination nav has no agent entry at all, so once a reader is
inside a journal there is no route to the helper; and the signed-in landing
spends most of a screen re-offering what the header should carry everywhere.

Since B770 the header is one row on a phone with a menu behind it, and
`useNavEntries()` in `components/SiteNav.tsx` is the single source of the
destinations. That is the seam this goes through.

## Work

**The agent entry is not one of the seven.** The other destinations are places
inside a journal — days, gallery, map, figures, search. `/agent` is where you
go to *write*, it is instance-level rather than trip-level, and the owner asked
for it to read as a call to action rather than another tab. So: an icon **and
the word**, at call-to-action weight, visually separated from the destination
icons rather than appended to them.

- On a phone, in the header row if it fits beside the title and the menu
  button — the row currently holds back, title, section disc, menu. If it does
  not fit, it is the first item in the menu panel and it is the emphasised one
  there. Measure at 390px and decide from the measurement, not from a guess.
- `yellow-400` with a `yellow-600` edge and `yellow-950` text is the
  established primary in this product since B733. Watch the collision: the
  header's current-section disc is also `yellow-400`. If both are yellow the
  row has two waymarks and neither means anything — resolve it deliberately
  and say how in this file.
- **Gate it on the `helper` capability.** With the helper off there is no
  `/agent` worth sending anybody to, and every self-hoster has it off. Same
  two-arrangement rule as B694 and B770.

**Docs gets a symbol too**, per request 3 — quieter than the agent, since it
is a reference rather than an action.

**Then take the block off the signed-in landing.** `components/Landing.tsx`
renders the write call to action, its explanatory paragraph, the
`AgentDisclosure`, and `DocsLink` for a signed-in reader. Once the header
carries both, that block is a second copy on the one page whose reader least
needs to be sold: they already have a journal. Remove it there; the signed-out
arrangement keeps everything it has, because that reader has no header entry
to use yet and is still deciding.

## Acceptance

- Every page inside a journal has a visible route to `/agent`, at
  call-to-action weight, with the word "Agent" shown wherever it fits.
- A docs symbol sits beside it, quieter.
- With the `helper` capability off, neither appears and nothing is broken.
- The signed-in landing no longer carries the write block, the disclosure or
  the docs link.
- The signed-out landing is unchanged.
- Every target ≥44px; checked at 390px; the header stays one row and no taller
  than B770 left it (65px). State the measured height.
