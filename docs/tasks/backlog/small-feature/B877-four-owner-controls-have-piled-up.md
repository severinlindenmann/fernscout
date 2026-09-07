---
id: B877
title: Four owner controls have piled up under a day with no order between them
type: FEATURE
priority: high
complexity: medium
area: agent, ui
found: "2026-09-07T17:43:07Z"
---

# B877 — Four owner controls have piled up under a day with no order between them

## Why

Under every published day, an owner now sees, in this order:

1. the reactions row (a reader's control, not the owner's)
2. **"Deine Leser über diesen Tag informieren"** — a bordered button
3. **"Familie zum Lesen einladen"** — a second bordered button
4. **"Diesen Tag korrigieren oder herunternehmen"** — a bold underlined link
5. **"Oder bitte um eine Änderung an diesem Reisetagebuch"** — a second
   underlined link, in a different size

Four owner controls in three visual styles, one after another, with nothing
saying they belong together or which to reach for. The owner said it plainly:
the options are wild.

Nobody designed this. `components/StoryPager.tsx:347-378` grew one control per
ticket — B799 added the invite, B816 the correction link, B844 the ask box —
each in a different session, none able to see the others, all correct in
isolation. It is what accretion looks like when every individual step was
right.

Two further faults now that they sit together:

- **Nothing separates the owner's tools from the reader's page.** The reactions
  row above belongs to readers; everything below is visible only to the owner,
  and the page never says so. A person cannot tell what their family sees.
- **The two links say almost the same thing** — "correct this day" and "ask for
  a change to this journal" — and one is a form, the other a text box.

## Work

One owner block, clearly the owner's, with an order that matches how often
things are done.

Design decisions worth making deliberately rather than by accretion:

- **Say whose these are.** A quiet heading — *"Nur für dich sichtbar"* — so an
  owner knows their family sees none of it. This is also the honest answer to
  "what does my mother see", which two testers asked and nobody answered.
- **One row, one weight.** These are four peers, not a primary and three
  afterthoughts: correcting, taking down, showing somebody, telling people.
  A compact row of labelled controls beats four stacked blocks in three styles.
- **Fold the ask box in** rather than leaving it as a fifth line. It is the
  general form of the same intent — the specific controls are the shortcuts.
- Keep the reactions row where it is, on the reader's side of the line, and
  draw the line.

Not doing: changing what any of the four controls does, or what they cost.
This is arrangement and labelling.

## Acceptance

An owner opening their own published day sees one block that is obviously
theirs, can tell at a glance what their readers see instead, and reaches any of
the four actions in one tap. Checked at 390px, in German.
