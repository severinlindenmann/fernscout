---
id: B432
title: Four German strings address the reader formally where the rest use du
type: ISSUE
priority: low
complexity: low
area: i18n, copy
found: "2026-09-05T09:55:14Z"
started: "2026-09-05T15:05:00Z"
session: e5747799-fd3e-4d40-a335-82fa4e24333e
claimed: "2026-09-05T15:05:00Z"
---

# B432 — Four German strings address the reader formally where the rest use du

## Why

The capture's own count was wrong. `content/locales/de.json` has 798 keys.
Grepping for capitalised formal-address markers (`Sie`, `Ihnen`, `Ihre*`,
`Ihres`, word-boundary matched, case-sensitive so lowercase `sie` = she/it/they
is excluded up front) turns up 13 lines, but 9 of those are `Sie` as a
capitalised, sentence-initial `sie` — "she/it/they" referring back to a
feminine or plural noun ("Die Seite … Sie zeigt dir …", "Sie wurde entfernt
oder umbenannt" of a trip, "Sie gehen heute in die Post" of postcards) — which
is ordinary German capitalisation, not formal address, and is correct as
written.

Only **four keys** genuinely address the reader as "Sie" (formal `you`) while
~199 other keys in the same file use `du`/`dein*`/`dich`/`dir` (informal):

- `me.signinExpired`: "Dieser Link war bereits benutzt und hat **Sie** deshalb
  nicht hereingelassen. Das kommt häufig vor und liegt nicht an **Ihnen**:
  E-Mail-Anbieter öffnen Links in einer Nachricht oft vor **Ihnen**. Fordern
  **Sie** unten einen neuen Code an, dann klappt es."
- `me.signinThrottled`: "Das waren viele Versuche in kurzer Zeit. Warten
  **Sie** ein paar Minuten und versuchen **Sie** es erneut, oder fordern
  **Sie** unten einen neuen Code an."
- `signin.body`: "Drücken **Sie** unten auf die Schaltfläche, und **Sie** sind
  drin. Mehr ist es nicht — **Sie** brauchen kein Passwort, und es gibt
  nichts auszufüllen."
- `signin.failed`: "Das hat nicht geklappt. Der Link wurde vermutlich schon
  benutzt — fordern **Sie** auf der Seite **Ihres** Journals einen neuen an."

All four are on the sign-in path (`me.*`, `signin.*`), so a reader hits
formal address at exactly the moment the rest of the journal has already
been speaking to them as `du` — the inconsistency is visible in one flow,
not scattered noise. It costs nothing functionally, only reads as an editing
seam: two registers of address for one reader in one product.

## Work

- Reworded the four keys above from formal (`Sie`/`Ihnen`/`Ihre*`, and the
  imperative `-en Sie` construction) to informal (`du`/`dich`/`dir`/`dein*`,
  and the plain imperative), keeping meaning, punctuation and interpolation
  identical. No keys added or removed, `en.json`/`hu.json` untouched.
- Corrected the task's own title and count: it was six versus a hundred and
  thirty; the real count is four genuinely-formal keys against roughly 199
  keys using informal markers (out of 798 keys total, most of which address
  nobody at all).
- **Not doing:** a blanket "ban capitalised Sie" lint — 9 of the 13 raw hits
  are legitimate sentence-initial `sie` (she/it/they), and a blind check
  would false-positive on those forever. Not touching the ~600 keys that use
  neither register (labels, dates, error codes with no second person).

## Acceptance

`npx vitest run test/locales.test.ts` — the new
`describe("German address is consistently informal (B432)")` block asserts
`me.signinExpired`, `me.signinThrottled`, `signin.body` and `signin.failed`
in the shipped `de.json` no longer match `/\b(Sie|Ihnen|Ihre[nrms]?|Ihres)\b/`.
This failed before the fix (all four matched) and passes after.

A broader "no formal address anywhere in de.json" test is deliberately not
what's left behind: it would need to distinguish formal `Sie` from
sentence-initial `sie` (she/it/they), and that distinction is a judgment call
a regex cannot make reliably — see the Why section for the 9 legitimate
hits it would otherwise flag. Re-run the same manual grep (word-boundary,
case-sensitive) and re-read each hit in context if this needs auditing again.

## What changed

`content/locales/de.json`:

- `me.signinExpired`:
  - before: "Dieser Link war bereits benutzt und hat Sie deshalb nicht
    hereingelassen. Das kommt häufig vor und liegt nicht an Ihnen:
    E-Mail-Anbieter öffnen Links in einer Nachricht oft vor Ihnen. Fordern
    Sie unten einen neuen Code an, dann klappt es."
  - after: "Dieser Link war bereits benutzt und hat dich deshalb nicht
    hereingelassen. Das kommt häufig vor und liegt nicht an dir:
    E-Mail-Anbieter öffnen Links in einer Nachricht oft vor dir. Fordere
    unten einen neuen Code an, dann klappt es."
- `me.signinThrottled`:
  - before: "Das waren viele Versuche in kurzer Zeit. Warten Sie ein paar
    Minuten und versuchen Sie es erneut, oder fordern Sie unten einen neuen
    Code an."
  - after: "Das waren viele Versuche in kurzer Zeit. Warte ein paar Minuten
    und versuche es erneut, oder fordere unten einen neuen Code an."
- `signin.body`:
  - before: "Drücken Sie unten auf die Schaltfläche, und Sie sind drin. Mehr
    ist es nicht — Sie brauchen kein Passwort, und es gibt nichts
    auszufüllen."
  - after: "Drück unten auf die Schaltfläche, und du bist drin. Mehr ist es
    nicht — du brauchst kein Passwort, und es gibt nichts auszufüllen."
- `signin.failed`:
  - before: "Das hat nicht geklappt. Der Link wurde vermutlich schon benutzt
    — fordern Sie auf der Seite Ihres Journals einen neuen an."
  - after: "Das hat nicht geklappt. Der Link wurde vermutlich schon benutzt
    — fordere auf der Seite deines Journals einen neuen an."

`test/locales.test.ts`: added the `describe("German address is consistently
informal (B432)")` block described in Acceptance.
