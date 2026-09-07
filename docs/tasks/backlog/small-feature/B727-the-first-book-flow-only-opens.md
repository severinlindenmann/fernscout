---
id: B727
title: The first-book flow only opens once, is laid out for a desktop, and draws a book as a grey rectangle
type: FEATURE
priority: high
complexity: medium
area: photobook, onboarding
found: "2026-09-07T00:00:00Z"
---

# B727 — The first-book flow only opens once, is laid out for a desktop, and draws a book as a grey rectangle

## Why

B704 shipped and the owner's verdict was "I really like where this is going" —
followed by four things, all of which are the same complaint: it is not doing
enough of the work, and it does not look like what it is about.

**It opens once and then hides.** `hadSaved === false` was the right instinct
for a wizard that stands between somebody and their book. It is the wrong one
for what this turned into: the questions *are* the composer for most people,
and an owner who wants them back has to find a text link inside a collapsed
settings panel. Open it every time; it takes four taps to leave.

**A book is drawn as a grey rectangle.** `FormatShape` gets the proportions
right and says nothing else, so "Quadratisch, 21 × 21 cm" is three grey boxes
of slightly different shapes — the owner's word was *misleading*. It is a
printed book: it has a cover, a spine and a stack of pages, and at 56px all
three of those are drawable.

**It is a desktop form on a phone.** Cards are `flex-1 basis-40`, so at 390px
every step is a single column of full-width cards and the three formats take
most of a screen to compare. The action row is a button beside two links at the
bottom of a long panel. This is the first thing an owner does with a photobook
and most of them do it on a phone.

**It asks four questions and leaves twenty decisions.** After the flow, the
composer still holds: which days are in the book, what each day looks like,
which photograph leads each day, the crop of each photograph, and the
language. The first three of those are answerable once, for the whole trip,
with a drawing beside each answer — which is what the flow is already for.

## Work

- **Always open it — and offer to carry on.** The flow opens on every visit,
  and where an arrangement already exists the first thing it shows is that
  choice: *carry on where you left off*, which goes straight to the composer,
  or *start from the questions*. So `hadSaved` stays and earns its keep — it
  is now the difference between a first screen that asks and one that does
  not. The one exception stands: an owner redirected back from paying meets
  the outcome panel, not a wizard.
- **Draw a book.** `FormatShape` becomes a closed book seen face on: cover,
  a spine down one edge, the page block showing at the other. True proportions
  as before — the shape is still the answer.
- **Mobile first.** Three formats in a row rather than a column; two columns
  for the word and extras cards; the primary action full width with the
  secondary ones as links under it; enough room under the panel that the
  floating navigation button does not sit on the last row.
- **Three more questions**, each one drawn, each one answering something the
  composer would otherwise ask twenty times:
  - *Wie sollen die Tage aussehen?* — one `DayLayout` for the whole trip,
    through the existing `applyLayoutToAll`, drawn with B703's `LayoutShape`.
    `auto` stays the recommended answer and the default.
  - *Welche Tage kommen ins Buch?* — the trip's days, all in, each one
    switchable, writing `DayPlan.excluded` exactly as the day controls do.
  - *In welcher Sprache?* — `locale`, and only where the journal offers more
    than one. Skipped entirely otherwise rather than shown with one option.
- Not doing: per-photograph anything. A crop and a hero are decisions about
  one picture, and the place to make them is in front of that picture.

## Acceptance

- The flow opens on every visit to the photobook page. With an arrangement
  saved, its first screen offers to carry on, and one tap reaches the composer
  with that arrangement intact.
- A format card is recognisably a book at 56px.
- Every step fits a 390px screen without the cards becoming a single column of
  full-width blocks.
- Answering the whole flow leaves a book whose days, layout, language and
  cover need no further editing.
- Looked at in a real browser at 390px, per `test-in-a-browser`.
