---
id: B294
title: The language switcher offers three languages for prose that only exists in one
type: FEATURE
priority: medium
complexity: high
area: i18n, entries
found: "2026-09-04T13:36:02Z"
---

# B294 — The language switcher offers three languages for prose that only exists in one

## Why

Tested and reported by an agent on 2026-09-04, and its account is accurate:

> Die API unterstützt aktuell keine Übersetzungen auf Tagesebene. … Ein
> `translations`-Feld gibt es nur für Trips (Titel/Tagline), nicht für einzelne
> Tage. … die Leser-Sprachumschaltung (`locales: de/en/hu`) betrifft nur
> UI-Chrome und Trip-Titel, nicht den Tagesinhalt selbst.

Confirmed: `translations` exists in `lib/tripWrite.ts` for a trip's title and
tagline, and the day-writing endpoint accepts no such field. So a journal that
declares `locales: ["de","en","hu"]` gets a switcher on every page, and a reader
who uses it gets English chrome, an English trip title, and German prose.

**The defect is the promise, not the absence.** A journal is somebody's writing,
and there is a strong argument that it should not be translated at all: an
agent that renders a person's memoir into three languages is inventing what
they said, which is the one thing this software forbids. B277 has just made
`locales` a required question at creation, so every new journal now declares
its reader languages deliberately — and what it declares is currently truer of
the furniture than of the content.

Two honest readings, and choosing between them is the work:

- **The switcher is over-promising.** `locales` means "the languages my site's
  chrome and titles appear in", and nothing says otherwise to the owner being
  asked the question or to the reader clicking the switch.
- **Day content should be translatable**, by the owner or by an agent working
  from what the owner actually wrote in each language — never by an agent
  translating unasked.

## Work

Decide which, then do the smaller thing that follows. Do not build translation
before the decision — a `translations` block on every entry is a large change
to the content model and to every reading path, and it is the wrong first move
if the answer is that prose stays in one language.

If **the switcher over-promises**: say what `locales` covers, in both generated
documents and in B277's creation question, so an owner choosing three languages
knows what they are choosing. Consider whether the switcher should say so too —
a reader who switches and sees German prose currently has no explanation.

If **days should be translatable**: it is a `translations` block per entry
mirroring the trip's, refused for a language the journal does not declare (as
`lib/tripWrite.ts:324` already does), plus a reading path that falls back to
the written language rather than showing nothing. And the rule that matters
more than the schema: an agent writes a translation only from words the owner
gave it in that language. An empty translation beats an invented one — the same
rule as every other field.

Check what `lib/entries.ts` and the day reading paths would need before
estimating either; the schema is the small part.

## Acceptance

Either the documents and the creation question say plainly what `locales`
covers, or a day can carry its prose in the journal's declared languages with
a documented fallback — and whichever is chosen, the reasoning is written down
where the next person reads it.
