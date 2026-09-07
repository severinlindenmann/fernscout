---
id: B704
title: A first photobook opens as a wall of settings with nothing to compare them against
type: FEATURE
priority: high
complexity: high
area: photobook, onboarding
found: "2026-09-07T00:00:00Z"
---

# B704 — A first photobook opens as a wall of settings with nothing to compare them against

## Why

Somebody who has never made a book opens the composer and is shown, at once:
a format dropdown, a cover picker, a language dropdown, two binding radios and
six checkboxes — *Texte mitdrucken, Routenkarte, Kapiteltrenner, Wer unterwegs
war, Kostenübersicht, Diagramme*. Every one of them is a real decision and not
one of them is illustrated. "Kapiteltrenner mitdrucken" is a yes/no about a
page the person has never seen.

B548 already moved these behind one entry, which was right for somebody
returning to a book they have arranged before. It does nothing for the first
one, where the questions are exactly the right questions and the *format* is
wrong: a list of switches, asked all at once, with no example beside any of
them.

The owner's ask: ask these questions one at a time, in a nice format, and
**always show an example** so the answer can be chosen from the picture rather
than from the word.

## Work

**The shape: four questions, four screens, one drawing per answer.** Every
question is a row of cards; every card is a schematic of what it does, in the
`LayoutShape` idiom B703 established — grey frames on a page, rules for prose.
Never the trip's own photographs, except once (Q4), where the photograph *is*
the question.

Every step arrives with an answer already chosen, so "Weiter" is always a
valid move and nobody is blocked by a question they do not care about. The
pre-selections are today's `initialBookOptions`, unchanged.

```
   ①────②────③────④        Dein erstes Buch
```

**Q1 — Wie gross?** The formats, drawn to scale against each other, price
under each. This is the only question that changes what it costs, so it is
first and it says so.

```
  ┌────┐   ┌──────┐   ┌────────┐
  │    │   │      │   │        │      Quadratisch    Hochformat    Quer
  │    │   │      │   │        │      21 × 21 cm     …             …
  └────┘   └──────┘   └────────┘      ab CHF xx      ab CHF xx     ab CHF xx
```

**Q2 — Mit Worten oder ohne?** Two cards: a day page with prose and captions,
and the same day as photographs with a date. This is `includeText`, and it is
the one switch that changes what the book *is* rather than what it contains.

```
  ┌────────┐   ┌────────┐
  │ ▓▓▓▓▓▓ │   │ ▓▓▓▓▓▓ │       Mit Texten          Nur Fotos
  │ ▓▓▓▓▓▓ │   │ ▓▓▓▓▓▓ │       Deine Tage, wie     Ein Fotoalbum mit
  │ ────── │   │        │       du sie geschrieben  Daten und Orten
  │ ─────  │   │        │       hast
  └────────┘   └────────┘
```

**Q3 — Was gehört noch dazu?** The remaining five switches as four tiles,
multi-select, each drawn as the page it adds and each carrying its page cost
so the consequence is visible before the answer:

| Tile | Switch | Drawn as |
| --- | --- | --- |
| Die Route | `includeMap` | the map schematic — a line with stops |
| Kapitel pro Land | `includeChapters` | a page with one large word centred |
| Wer unterwegs war | `includeNames` | the title page, with figures |
| Zahlen und Diagramme | `includeCosts` + `includeCharts` | a page of bars |

The last two switches are one tile on purpose: "Kostenübersicht" and
"Diagramme" are one decision to somebody who has not read the planner, and
B642 already ties their defaults together. The settings panel keeps them
separate for anybody who wants them separate.

A tile is only offered where the trip has the data — no `weatherData` and no
budget means no Zahlen tile at all, rather than a tile that adds nothing.

**Q4 — Welches Foto vorne drauf?** The one screen with real photographs: six
to eight of the trip's own, the planner's pick already selected, and the
spine string (`spineTextFor`, B642) shown beside them so the thing printed
down the edge is not a surprise. Skippable — the book chooses.

**Two questions are deliberately not asked.**

- **Bindung.** It depends on the page count, which the planner knows and the
  owner does not; asking somebody to choose between "geklebt" and "geheftet"
  before a book exists is asking them to guess. The wizard's last screen
  *states* it — "Dein Buch hat 64 Seiten, also geklebter Rücken" — and the
  settings panel keeps the radios.
- **Sprache.** It defaults to the journal's own locale, which is right
  essentially always, and it is one dropdown in the panel. A screen for it
  would be a screen about nothing.

**When it appears, and when it never does again.** `usePersistedState` already
answers this: nothing under the composer's `localStorage` key means nobody has
arranged this book, which is exactly "first time". A saved arrangement skips
the flow entirely — the flow must never stand between somebody and a book they
have already made. The settings panel gains one link, *Von vorne anfangen*,
which is the only way back into it.

**What it writes.** `BookOptions`, and nothing else. The wizard is a different
way to *reach* the same object the panel edits, not a second state: leaving it
lands on the composer as it exists today, already arranged, with a line saying
every answer is still changeable under "Ändern, wie das Buch gemacht wird".

**Not doing:**

- Real spreads as the examples. They need the whole planner per keystroke, and
  the answer to "what does a chapter divider look like" must not depend on
  which photographs this trip happens to have.
- A wizard for the per-day work. B703 is where a day is arranged, and that is
  a place to come back to, not a queue to be walked through once.
- Any new option. Every question here is a switch that already exists.

## Acceptance

- A journal with no saved arrangement opens the photobook page on Q1, not on
  the composer.
- Every question shows a drawing of each answer, and answering none of them —
  four taps of "Weiter" — produces exactly the book `initialBookOptions`
  produces today.
- A second visit goes straight to the composer, and *Von vorne anfangen*
  is the only thing that reopens the flow.
- The binding is stated with its page count rather than asked.
- Looked at, per `check-a-drawing`: every schematic on `/docs/branding/day`
  beside B703's six, and the four screens at 390px.
