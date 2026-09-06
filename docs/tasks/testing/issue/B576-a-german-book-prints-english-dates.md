---
id: B576
title: A German book prints English dates
type: ISSUE
priority: medium
complexity: low
area: photobook, i18n
found: "2026-09-06T13:47:14Z"
merged: "2026-09-06T14:12:19Z"
---

# B576 — A German book prints English dates

## Why

B503 gave the book its own language: the owner picks it in the composer, and
`lib/photobook/strings.ts` carries the headings in English, German and
Hungarian. Every heading obeys it. **No date does.**

`formatDate` and `formatDateRange` in `lib/photobook/text.ts:255` build their
output from a module-level English `MONTHS` array and take no locale argument at
all. Nine call sites across `lib/photobook/` use them: the title page, the
chapter dividers, every day page, the colophon, and — since B565 — the axis
labels on the charts.

So a German book prints "5 September 2025" and a Hungarian one prints the same.
Some months collide harmlessly (September), which is exactly why this has
survived: it looks translated until it is March, May, October or December, or
until the reader is Hungarian, for whom none of it is right and the word order
is wrong too.

Found while reviewing B565, which did not cause it but did put dates on two more
pages and made it easier to see. Filed separately because it is the language
feature that is broken, not the charts.

## Work

Thread the book's locale into the two functions and take the month names from
the same place the rest of the book's vocabulary comes from — `bookStrings`
already resolves per locale and is already handed to the planner.

Watch the *shape* as well as the words. German writes "5. September 2025" with
the ordinal point, and Hungarian puts the year first and the month before the
day ("2025. szeptember 5."). A month-name lookup with the English order left in
place is only a third of the fix, and it is the tempting third.

`formatDateRange` collapses what two dates share — "14–28 August 2026". That
collapsing rule is language-specific too; do not assume it survives translation
unchanged.

**Not doing:** `Intl.DateTimeFormat`, unless somebody checks it against the
book's fixed page geometry first. The planner measures text to decide what fits,
and a formatter whose output varies with the platform's ICU data is a
measurement that changes under you.

## Acceptance

- A book made in German prints German dates, in German order, on the title page,
  the chapter dividers, the day pages, the colophon and the chart axes.
- The same for Hungarian.
- An English book is unchanged.
