---
id: B1072
title: Two more components format a date in whatever locale the renderer happens to have
type: ISSUE
priority: medium
complexity: low
area: i18n, helper
found: "2026-09-09T07:33:20Z"
---

# B1072 — Two more components format a date in whatever locale the renderer happens to have

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`lib/i18n.ts` carries month and weekday names per locale, and says why in a
comment beside them: *"Dates stay deterministic — never `toLocaleDateString`,
which differs between server and browser."*

Two client components call it anyway:

- `components/HelperAsk.tsx:926`
- `components/RoomOpening.tsx:64` and `:99`

Both pass `undefined` as the locale — `toLocaleDateString(undefined, { … })` —
which means *whatever locale the renderer happens to have*. On the server that
is the Node process's; in the browser it is the reader's. Both do pin
`timeZone: "UTC"`, so the harder half of the trap is already closed and only
the language and ordering can drift. `"use client"` does not save them: those
components still render on the server first, which is exactly when the two
copies are compared.

Found on 2026-09-09 after the same mistake in `components/HelperConsentList.tsx`
was caught in a browser — there it threw a real hydration mismatch on every
load of `/<user>/me`, rendering `01/09/2026` against `9/1/2026`. That one is
fixed and is the pattern to copy: take `formatLongDate` (or `formatShortDate`)
off the `useI18n()` context, which `components/LocaleProvider.tsx` builds from
`monthNames`/`weekdayNames`.

Nobody has seen these two fail, which is worth saying plainly: a mismatch only
surfaces when the server's locale and the reader's disagree, and on this
instance they may well not. That makes it a latent fault rather than a live
one — and the reason to fix it by rule rather than by waiting for a report.

## Work

- Replace both call sites with the context formatters. Neither needs a new
  string.
- `RoomOpening.tsx` asks for `weekday: "long"` and `HelperAsk.tsx` for
  `"short"`; `formatLongDate`/`formatShortDate` are the two shapes the provider
  already offers, so check the rendered wording still reads well in all three
  languages rather than assuming the mapping is exact.
- Then grep for `toLocaleDateString`, `toLocaleTimeString` and
  `toLocaleString` across `components/`, `app/` and `lib/` and either fix or
  justify every remaining hit in the same pass — a rule enforced in two places
  and violated in a third is not a rule.

Not doing: a lint rule. It is worth considering if this recurs a third time
(the `hookify` skill is the tool), but three call sites do not yet justify one.

## Acceptance

- No `toLocaleDateString` remains in a component that renders on the server,
  or the ones that do carry a comment saying why they are safe.
- `/agent` and the helper room load with no hydration warning in the browser
  console, checked with the server's locale deliberately set to something the
  browser is not.

