---
id: B506
title: Nobody has looked at the photobook composer or the drawn travellers in a browser
type: OPS
priority: high
complexity: medium
area: photobook, travellers, testing
found: "2026-09-05T17:50:06Z"
merged: "2026-09-05T18:36:44Z"
---

# B506 — Nobody has looked at the photobook composer or the drawn travellers in a browser

## Why

Two substantial features shipped today without a person or an agent seeing them
rendered in a browser.

**The composer** (B504) — a list of days, each with six layout choices and its
own photo grid. Its planner is exhaustively unit-tested and the whole tree
passes `npm run verify`, but every one of those tests asserts about a page
*plan*. None of them says whether the thing is usable, whether the accordion
works on a phone, or whether a forty-day trip is legible in a 20rem column.

**The drawn travellers** (B497, another session) — 1,449 lines across
`lib/travellers/`, five test files, seventy-one passing tests, four demo trips
carrying a `travellers:` block, and figures rendered into both the PDF and the
HTML preview. It looks well built. Nobody has said whether the people look like
people at print size, or whether a figure somebody described comes out as the
person they described.

Blocked on B505 for the browser half. The print half is not blocked: the CLI
renders books today and poppler rasterises them.

## Work

Two passes, and the second does not need B505.

**In the browser, once B505 lands.** Open the composer at a phone width and at
desktop. Walk a real arrangement on a long trip — `parks-2025` is eighteen days
— and order a book end to end with credits on and the dry-run provider:
preview, price, pay, the outcome panel, the download links, the `.eml`. Note
what is awkward, not only what is broken.

**On paper, now.** Rasterise the title page and colophon of a trip whose
travellers are described, at print resolution and at thumbnail size. Check that
a trip with no `travellers:` block prints no figures rather than a default pair
— B497's own rule. Check the preview's SVG figures and the PDF's agree, since
they are drawn from one geometry in two spellings and that is exactly the
pairing that drifts.

Findings become tickets. This one's deliverable is the findings, not a diff.

## Acceptance

- A written list of what is wrong or awkward, each item either fixed or filed.
- At least one screenshot of the composer at 390px and one at desktop.
- A statement about whether the drawn figures are good enough to print, from
  somebody who has looked at them at the size they will be printed.
