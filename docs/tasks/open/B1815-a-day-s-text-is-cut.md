---
id: B1815
title: A day's text is cut where it does not fit, and the book has one shape for every length of writing
type: FEATURE
priority: high
complexity: high
area: photobook, text layout
found: "2026-09-16T18:11:09Z"
---

# B1815 — A day's text is cut where it does not fit, and the book has one shape for every length of writing

## Why

Reported by the owner on 2026-09-16: a day's text is sometimes too long, and it
overlaps the photographs.

What the planner actually does with a long day is worse than overlapping it — it
throws the end of it away. `dayTextBudget` (`lib/photobook/plan.ts:1094-1108`)
measures the column, subtracting the heading and, when the page carries a photo,
a flat `0.52 * trimHeightMm` for it. `fitDayText` (`:1117-1127`) wraps the
paragraphs against real Helvetica advance widths — `lib/photobook/text.ts` embeds
the Core-14 metric tables and `wrap()` at `text.ts:223` breaks lines exactly —
and returns `maxLines`. `materialise` (`:1595-1610`) then slices the lines to
that number and raises a `text-truncated` warning. The rest of what the person
wrote is simply not printed.

Proven on the existing test, unmodified:

```
npx vitest run test/photobook-day-plans.test.ts -t "still truncates"
 Test Files  1 passed (1)
      Tests  1 passed | 54 skipped (55)
```

— a 200-word day, default options, `truncated: true` and the warning raised.

The one escape is `runOn` (B517, `plan.ts:1276-1292`), which splits the day
across two pages. It is **off unless the owner sets it on that specific day**
(`chosen?.runOn === true`), and it yields exactly one continuation page, not as
many as the writing needs.

So there are two faults with one cause, and the overlap the owner saw is
probably the second one: `typeScale` (`plan.ts:511`) fixes the body size per
book, the budget is computed once from a flat photo share, and nothing adapts. In
the **printed** PDF an over-long day is cut. In the **on-screen preview**, which
re-renders those same lines as HTML `<p>` elements at point sizes
(`lib/photobook/preview.ts:413`), the browser's line height is not the metric the
budget was computed from, so text can spill past its box and over the photograph
even though the PDF would not. That hypothesis is the first thing to prove or
kill — with a browser, on the trip where the owner saw it.

Nothing in the layout system offers a long day more room. `PhotoLayout`
(`plan.ts:241-249`) and the day-level `layout: "text"` only change which
photographs are placed, never the column. (`lib/photobook/shapes.ts` is unrelated
— it draws the traveller figures.) There is no shrink step and no multi-page
spill.

The one thing in this ticket's favour: the rendering is a hand-written
`PdfBuilder` (`lib/postcard/pdf.ts`), not HTML-to-PDF, and exact text measurement
is already there and already used. Fitting text properly is arithmetic in
`plan.ts`, not a change of technology.

## Work

**Blocked on a decision, and the decision needs pictures.** Asked on 2026-09-16
whether generation should run text on to further pages, shrink the type to fit,
or try a step or two of shrink before spilling, the owner answered: *"maybe we
can also give different layouts and formats for text to make it look better? and
accompany different types of texts? maybe give me some visual examples I can
check and see."*

So the deliverable of the next step is an artifact of worked text-page
treatments — a short day, a long day, a day of several paragraphs, a day with a
photograph and a day without — for the owner to choose from. This section gets
rewritten with the chosen shapes before the ticket leaves `open/`.

Two things are in scope whatever is chosen:

- **Nothing the person wrote may be silently dropped.** Whether by shrinking,
  running on, or choosing a text-shaped layout, the end state is that a printed
  book contains the whole of what was written, or says plainly that it does not.
- **The preview and the PDF must agree.** If the browser spills where the PDF
  cuts, the preview is lying about the book, and that is fixed here.

Not doing: rewriting anyone's text, or summarising it to fit. Never.

## Acceptance

- The chosen treatment rendered as real PDFs across the range of day lengths
  above, in at least two trim sizes, inspected as drawings via
  `check-a-drawing`.
- A day long enough to overflow prints in full, and `text-truncated` is either
  gone or means something the owner can act on.
- The on-screen preview of those same days matches the PDF: no text over a
  photograph, verified in a browser at desktop and phone width.
- `test/photobook-day-plans.test.ts` updated to the new contract, with the
  200-word case asserting the new behaviour rather than truncation.
- `npm run verify` green.

## What the research found — 2026-09-16

The owner asked for a wider menu than "run on / shrink / two columns", with
pictures. Twelve treatments were drawn; the ones with an observed precedent
are marked as such.

**The craft order, from typesetting practice:** edit the words, then micro-
adjust tracking and leading within a tolerance, then let the frame grow.
Scaling type hard and shrinking images are named as the most visible, last
resorts. Fernscout skips every step of that and cuts — and cutting is the one
move not available here at all, because the words belong to the person who
wrote them.

**Observed in a shipping product.** Polarsteps makes exactly one automatic
decision on length: a step whose text exceeds one column loses its photograph
and is promoted to a text-only page. That is the whole policy, and it is
binary. Nothing else found — Blurb, Artifact Uprising and Papier all leave
overflow to the customer, which is a gap rather than a solved problem.

**Devices for a day that is too long:** the text-only page (Polarsteps), the
run-on with a running head, the margin column that absorbs the overflow in a
smaller size (Tufte's sidenotes), the pull quote to break the block.

**Devices for a day that is too short** — the other half of the same problem,
and the one nobody has raised yet: the enlarged display setting, the
full-bleed photograph with the text as a caption, two short days sharing a
spread (no product precedent found; inferred from modular-grid practice), the
half-title breather page.

**The whole-book answer** is a small set of named page shapes — four to six —
chosen per day from the measured line count and photo count. Commercial
modular photobook products ship the shapes and let a person choose; only
Polarsteps chooses automatically, and only between two. Building the selection
policy is the real work; the shapes are the easy part.

Everything needed to measure is already here: `lib/photobook/text.ts` carries
the Core-14 Helvetica advance widths and `wrap()` breaks lines exactly, so
this is arithmetic in `plan.ts`, not a change of rendering technology.

Options drawn for the owner, with real days from `content/example`:
`https://claude.ai/artifact/TeaPRjdWuNn77ULDoWknwo`
