---
id: B481
title: The Hungarian and German interfaces switch between addressing the reader as te and as Ön
type: ISSUE
priority: low
complexity: low
area: i18n
found: "2026-09-05T15:15:00Z"
started: "2026-09-05T15:23:38Z"
session: e5747799-fd3e-4d40-a335-82fa4e24333e
claimed: "2026-09-05T15:23:38Z"
---

# B481 — The Hungarian and German interfaces switch between addressing the reader as te and as Ön

## Why

Found while working B449 on the Hungarian reader guides. The guides address the
reader informally throughout — *te*, *jelentkezz be*, *nyomd meg* — which is
what `content/locales/hu.json` does almost everywhere too. Four strings do not,
and they are strings a reader meets at the worst moment:

- `me.signinExpired` — *"nem Ön hibázott … Kérjen lent egy új kódot"*
- `me.signinThrottled` — *"Várjon néhány percet, és próbálja újra"*
- `signin.body` — *"Nyomja meg az alábbi gombot, és már benn is van"*
- `signin.failed` — *"kérjen újat a naplója oldalán"*

`signin.identityBody` says the same thing as `signin.body` one screen away and
says it with *te* (*"Nyomd meg az alábbi gombot"*), so the two forms sit
side by side on the sign-in flow. A reader who has been called *te* on every
page and is then addressed as *Ön* the moment something goes wrong reads it as
the site backing away from them.

B432 is the same shape in German — six strings there address the reader with
*Sie* — which suggests one pass, not two.

Not the guides' problem: `docs/guides/hu/*` is consistently informal. This is
the dictionary.

## Work

Rewrite the four Hungarian strings above to the informal *te*, matching the
rest of `hu.json`. Then check whether B432's German list and this one are the
same strings by key — if they are, the two tasks are one pass and one of them
should be marked `superseded:`.

Not in scope: choosing which register the product uses. Informal is what the
overwhelming majority of both dictionaries already do, and this is bringing the
strays into line rather than reopening the decision.

## Acceptance

`grep -nE "Ön|Kérjen|Várjon|Nyomja|kérjen|próbálja" content/locales/hu.json`
returns nothing, and a Hungarian reader who mistypes a code twice is addressed
the same way as one who does not.
