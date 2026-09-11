---
id: B1273
title: Six person-facing strings print photograph(s) and Credit(s) instead of using the plural mechanism
type: ISSUE
priority: medium
complexity: low
area: i18n, helper
found: "2026-09-10T10:17:47Z"
started: "2026-09-11T04:33:18Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T04:33:18Z"
---

# B1273 — Six person-facing strings print photograph(s) and Credit(s) instead of using the plural mechanism

## Why

On the helper's attach card, on a phone, twice on the same screen:

> **3 photograph(s)** from the inbox go onto 2026-09-05 — "Old town, bears, and
> Einstein". They leave the inbox and belong to the day.

`photograph(s)` is a shape from a form, not from a sentence, and it is on the
card a person presses to put their holiday photographs into their journal.

Six strings in `site/locales/en.json` do this:

| key | reads |
| --- | --- |
| `agent.tool.attachFiles` | `{count} photograph(s)` |
| `notify.short` | `{needed} credit(s)` |
| `agent.tool.proposePostcards` | `{count} card(s)` |
| `agent.tool.proposePostcardsFree` | `{count} card(s)` |
| `agent.tool.cleanup` | `{files} file(s)` |
| `photobook.print.orderIntro` | `{volumes} book(s)` |

German carries the same shape — `{count} Foto(s)`, `{needed} Credit(s)`,
`{count} Karte(n)` — and `(n)` is not a thing German writes either. Hungarian is
already correct in all three, because Hungarian does not pluralise a noun after
a number, so the translator wrote the sentence properly and only the two
languages that need the mechanism are missing it.

The mechanism is already here and already used: `tn()` with a `.one` sibling
key, the way `agent.creditsLow` / `agent.creditsLow.one` do it.

## Work

- Give each of the six a `.one` sibling in all three locales and switch the
  call site to `tn()`.
- Hungarian keeps one form for both; that is correct and not an omission.
- While you are there, check whether anything else in the three locale files
  carries a parenthesised plural — a grep for `(s)` and `(n)` is the whole
  check.

## Acceptance

- Attaching one photograph reads "1 photograph"; attaching three reads
  "3 photographs". Same in German.
- `npm run verify` passes, including `test/locales.test.ts`.
- No string in `site/locales/*.json` contains a parenthesised plural suffix.
