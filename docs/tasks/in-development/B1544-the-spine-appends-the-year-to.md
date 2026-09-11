---
id: B1544
title: The spine appends the year to a title that already carries one, and the owner cannot say otherwise
type: FEATURE
priority: medium
complexity: low
area: photobook
found: "2026-09-11T21:26:00Z"
started: "2026-09-11T21:31:04Z"
session: 57d87f37-ef96-4bb1-8533-8025978abf0c
claimed: "2026-09-11T21:31:04Z"
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

Watch the width: `spineTextSize()` (`lib/photobook/render.ts:1047`) returns
`null` when the text will not fit and the spine prints bare. A free-text field
makes a too-long string easy to type, so the order page has to show the same
"this will not fit" answer the renderer would reach, rather than accepting it
and printing nothing.

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
