---
id: B1544
title: The spine appends the year to a title that already carries one, and the owner cannot say otherwise
type: FEATURE
priority: medium
complexity: low
area: photobook
found: "2026-09-11T21:26:00Z"
started: "2026-09-11T21:31:04Z"
merged: "2026-09-11T21:58:03Z"
---

# B1544 — The spine appends the year to a title that already carries one, and the owner cannot say otherwise

## Why

`spineTextFor()` (`lib/photobook/plan.ts:108`) is
`` `${title} · ${start.slice(0, 4)}` ``, unconditionally. A trip called
"Algarve 2026" — which is how people name trips — prints as
**"Algarve 2026 · 2026"** down the spine of a book somebody paid to have made.
Seen on a real render.

The year was added because most titles do not carry one and a shelf of books
called "Portugal" is unreadable. That reasoning is still right; doing it
without looking at the title is what is wrong. And there is no way out of it:
the spine string is derived, the order page shows it (`app/[user]/(trip)/
photobook/page.tsx:47` calls the same helper, deliberately, so the person sees
what will be printed), but nothing on that page can change it.

The owner asked for both halves: stop appending a year the title already has,
and let them set the spine text themselves.

## Work

Two changes, and the second is the real one — the first is only a good default.

1. **Do not append a year the title already carries.** In `spineTextFor()`,
   skip the suffix when the title already contains the start year as a
   four-digit run. Nothing cleverer: no date parsing out of prose, no
   "2025–2026" range handling. A title that says a *different* year than the
   trip started still gets the trip's year appended — that is the author
   contradicting the dates, not us, and quietly hiding it is worse.

2. **Let the owner set it.** An optional `spineText` on `BookOptions`
   (`lib/photobook/options.ts:17`), absent meaning "derive it", plus a text
   field on the order page beside the other switches. Absent is the normal
   case and must plan exactly as it does today. `spineTextFor` gains the
   override as an argument, or the two call sites consult the option before
   calling it — one of the two, not both.

Watch the width — **and this paragraph was wrong when it was written.**
`spineTextSize()` (`lib/photobook/render.ts:1047`) does return `null` and print
a bare spine, but it is measuring the spine's *thickness* against the type's
size and never looks at the text at all: a thin enough book gets no title
however short the title is. What a long title actually does is overrun the
spine's *length* — `renderCover` centres the rotated line on the panel height
without measuring it, so anything longer than the book is tall runs off both
ends and is trimmed away. Same conclusion, different mechanism: the length
has to be bounded.

Not doing: the front cover or the title page, which print the trip title alone
and are not wrong. This is the spine only.

A new field on the order page is a new locale key, so English, German and
Hungarian, and `npm run i18n:keys`.

## Acceptance

- A trip titled "Algarve 2026" starting in 2026 has a spine reading
  "Algarve 2026", not "Algarve 2026 · 2026".
- A trip titled "Algarve" starting in 2026 still reads "Algarve · 2026".
- An owner can type their own spine text on the order page, see it in the
  preview string before ordering, and a saved arrangement keeps it.
- A too-long custom title is refused or warned about on the page, not silently
  dropped at render time.
- Seen on a real book of an existing trip, not a fixture — the spine is the one
  part of a photobook no test looks at.

## What was found and done

**Valid.** `spineTextFor()` was `` `${title} · ${start.slice(0, 4)}` `` with no
condition, and its two callers — the planner and the order page — both went
through it, which is why the page showed the duplicate too rather than
catching it.

Both halves built as described, with one correction to the Work section above
(the width paragraph: the failure mode is an overrun along the spine's length,
not the renderer dropping the title). What follows from that correction is the
shape of the guard: a **length cap**, `MAX_SPINE_TEXT = 60`, enforced in
`parseOptions` and again as `maxLength` on the field. The number is derived
from the smallest book — 140 mm tall, 7 pt type, ~1.4 mm a character, so a
hundred characters is where the shortest book is in trouble — and written down
beside the constant rather than left as a round number somebody later "tidies".

Three things worth knowing about the shape:

- **`coverFor()` takes the override as an argument** rather than reading
  `options`, because it takes no options today and threading the whole object
  in to read one string is a wider door than the change needs.
- **Blank never reaches an arrangement.** `parseOptions` drops an
  all-whitespace value instead of storing it, so "clear the field" reads back
  as "derive it" — the same shape `cover` uses for "the planner picks", and
  the reason the field can be blanked to get the default back without the
  owner having to remember what it was.
- **The row is stacked, not inline.** Every other control in the panel puts
  its value beside its label, and sixty characters beside a label in a 24rem
  card is a slot showing nineteen of them — the first build did exactly that
  and the screenshot showed "Down the Susten, tw". `Row` gained a `stacked`
  variant for it.

`DayLevelView` renders the same settings panel as `BookLevelView`, so the new
prop is threaded through both — the compiler found that, not a reader.

## Evidence

- `test/photobook-options.test.ts` — a new "the spine" block, seven
  assertions, all against a real `planBook`: the year appended when the title
  lacks it, not appended when it has it, still appended when the title names a
  different year, the owner's words beating both, blank meaning derive,
  60 characters accepted and 61 refused, and an arrangement stored before the
  field existed still parsing.
- `npm run verify` — all 5 steps green, twice (once after the panel was
  restacked).
- Driven in a real browser against `example/alps-2024`, an existing trip
  nobody wrote for this change, signed in as the owner. Before:
  placeholder and sentence both "Four days round the Alps · 2024", `maxLength`
  60. After typing: *"The spine is printed with “Down the Susten, twice”."*
  Captures in the run's scratch directory — `b1544/before-1280.png`,
  `after-1280.png`, `after-390.png`, `spine.json`. 200, no console errors, no
  failed requests.
- The 390 px pass carries the same JSON; the stacked row is full-width and the
  page does not scroll sideways.

Not covered by evidence, and deliberately: a printed PDF carrying a *custom*
spine. `npm run photobook` plans with `DEFAULT_OPTIONS` and has no flag for
one, and adding a CLI flag to prove a UI field is a wider change than the
ticket. `cover.spineText` is asserted straight off `planBook`, which is the
value `renderCover` draws.
