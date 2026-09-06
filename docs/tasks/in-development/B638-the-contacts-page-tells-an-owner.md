---
id: B638
title: The contacts page tells an owner no trip is open to guests when every trip is public
type: ISSUE
priority: medium
complexity: low
area: contacts page, i18n
found: "2026-09-06T17:51:55Z"
started: "2026-09-06T17:55:54Z"
session: e5f23c58-bb87-4175-ad7b-5d3aed93169f
claimed: "2026-09-06T17:55:54Z"
---

# B638 — The contacts page tells an owner no trip is open to guests when every trip is public

## Why

`/example/contacts` tells the owner:

> Wer du freigibst, kommt ins Tagebuch — aber noch keine deiner Reisen ist für
> Gäste geöffnet, also gibt es dort nichts zu lesen.

The example journal and its trips are entirely public, so this is false, and it
sends the owner off to change a visibility that is already right. The string is
`contact.adminNoGuestTrip` (`site/locales/de.json:75`); the condition that shows
it evidently tests for a trip whose visibility is literally `guest` and treats
`public` as if it were closed.

A guest approved on a fully public journal can read everything — there is
nothing to open. The message is only true when no trip is readable by a guest
*at all*, which `public` trips make untrue.

## Work

- Fix the condition: the question is whether an approved guest would be able to
  read anything, so a `public` trip counts.
- Check the English string and any other locale that carries it — the wording
  is fine, the trigger is not.

## Acceptance

- `/example/contacts` does not show the message.
- A journal whose every trip is `private` still shows it.
