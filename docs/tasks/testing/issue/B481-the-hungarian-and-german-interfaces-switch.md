---
id: B481
title: The Hungarian and German interfaces switch between addressing the reader as te and as Ön
type: ISSUE
priority: low
complexity: low
area: i18n
found: "2026-09-05T15:15:00Z"
started: "2026-09-05T15:23:38Z"
merged: "2026-09-05T15:33:11Z"
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

## What changed

Verified the ticket's own count first: `content/locales/hu.json` has 838 keys.
Word-boundary grepping for `Ön`, `Önt`, `Önnek`, `Öné`, `Önök*` and the formal
imperative endings (`Kérjen`, `Várjon`, `Nyomja`, `próbálja`, `kérjen`) turns up
one extra raw hit beyond the four keys the ticket names — `mail.identityWhat`
contains "Önmagában" ("by itself"), which is the Hungarian shape of German's
sentence-initial capitalised "sie": the string `Ön` inside a longer word,
not the formal pronoun. It is legitimate and untouched. So the ticket's count
of **four** genuinely-formal keys was correct on inspection — no title or
filename correction needed. Roughly 35 other keys already address the reader
with `te`/`téged`/`neked` (informal), so this was four strays against an
already-informal dictionary, the same shape as B432.

`content/locales/hu.json`:

- `me.signinExpired`:
  - before: "Ezt a hivatkozást már használták, ezért nem engedte be. Ez
    gyakori, és nem Ön hibázott: a levelezőszolgáltatók gyakran Ön előtt
    megnyitják az üzenetben lévő hivatkozásokat. Kérjen lent egy új kódot, és
    működni fog."
  - after: "Ezt a hivatkozást már használták, ezért nem engedett be. Ez
    gyakori, és nem te hibáztál: a levelezőszolgáltatók gyakran előtted
    megnyitják az üzenetben lévő hivatkozásokat. Kérj lent egy új kódot, és
    működni fog."
- `me.signinThrottled`:
  - before: "Ez sok próbálkozás volt rövid idő alatt. Várjon néhány percet, és
    próbálja újra, vagy kérjen lent egy új kódot."
  - after: "Ez sok próbálkozás volt rövid idő alatt. Várj néhány percet, és
    próbáld újra, vagy kérj lent egy új kódot."
- `signin.body`:
  - before: "Nyomja meg az alábbi gombot, és már benn is van. Ennyi az egész —
    nincs szükség jelszóra, és nincs mit kitölteni."
  - after: "Nyomd meg az alábbi gombot, és már bent is vagy. Ennyi az egész —
    nincs szükség jelszóra, és nincs mit kitölteni."
- `signin.failed`:
  - before: "Ez nem sikerült. A hivatkozást valószínűleg már használták —
    kérjen újat a naplója oldalán."
  - after: "Ez nem sikerült. A hivatkozást valószínűleg már használták — kérj
    újat a naplód oldalán."

Each rewrite re-conjugates the whole sentence rather than swapping only the
pronoun: past tense `hibázott` (Ön, 3rd person) → `hibáztál` (te, 2nd person);
`engedte be` (definite conjugation, matching a formal-object reading) →
`engedett be` (indefinite, since a `te`/`téged` object never takes definite
conjugation); the postposition `Ön előtt` → `előtted`; the possessive `naplója`
(3rd-person suffix, used for the grammatically-3rd-person `Ön`) → `naplód`
(2nd-person suffix) — the exact case named in AGENTS.md's worked example. The
formal imperatives `Kérjen`/`Várjon`/`Nyomja meg`/`próbálja` become the
informal imperatives `Kérj`/`Várj`/`Nyomd meg`/`próbáld`, matching the style
already used one screen away in `signin.identityBody` ("Nyomd meg… és bent
vagy") and `signin.identityFailed` ("kérj újat"). `signin.body` also switched
the spelling `benn` → `bent` to match `signin.identityBody`'s existing
spelling of the same word, for consistency between the two near-duplicate
strings.

No `út`/`utazás` terminology appears in any of the four strings, so nothing to
fix in passing there.

`en.json` and `de.json` were not touched.

## Evidence

`npx vitest run test/locales.test.ts` — added
`describe("Hungarian address is consistently informal (B481)")`, mirroring
B432's German test: asserts `me.signinExpired`, `me.signinThrottled`,
`signin.body` and `signin.failed` in `hu.json` no longer match
`/\b(Ön|Önt|Önnek|Öné|Önnel|Önök\w*|Kérjen|Várjon|Nyomja|próbálja|kérjen)\b/`.
This failed before the fix (all four matched) and passes after. A blanket
"no Ön anywhere" test is deliberately not what's left behind, for the same
reason B432 didn't add one for German: `Önmagában` is a legitimate hit a
regex can't distinguish from formal address without judgment — see above.

`npm run verify` — full build → tsc → eslint → vitest, all green (pasted in
the PR/report).
