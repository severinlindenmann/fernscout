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

**Decided by the owner on 2026-09-04: a day carries its prose in every language
the journal declares.** If a journal enables three languages, a day is written
in three. The switcher stops over-promising by the content catching up, not by
the promise being trimmed.

This resolves the tension in the Why in the only way that does not licence
invention. An agent still may not translate a person's memoir — the rule is
unchanged and absolute: **the other languages come from the owner, in their own
words, or they do not come.** What changes is that a journal declaring three
languages is understood as a commitment to write three, and the remedy for an
owner who writes only German is to declare only German — `PATCH
/api/v1/<user>/config` accepts `locales`, so that is a one-call correction
rather than a rebuild (B277 made it a deliberate choice at creation, and B220
made it changeable afterwards).

- **A `translations` block per entry**, mirroring the trip's in
  `lib/tripWrite.ts:315-340`: keyed by locale, refused for a language the
  journal does not declare — that refusal already exists for trips and should
  read the same way here.
- **Which fields.** `title` and `content` at least, since those are the prose.
  Decide about `location` and `tags` by reading how they are rendered and
  searched; a tag translated in one language and not another may break the tag
  index, so check before including them.
- **Reading path with a fallback.** A reader on a language a day does not carry
  sees the language it was written in, never an empty page. Say which language
  they are reading if it is not the one they asked for — a reader who switched
  and got German prose with no explanation is the defect this ticket opened
  with.
- **Refuse a day that omits a declared language, and name the language that is
  missing** — the owner's decision on 2026-09-04, so this is settled.

  `400`, nothing written, and the message says which locales were expected and
  which arrived: an agent that is told *"this journal writes in de, en and hu;
  `content` is missing for en and hu"* can go back to its owner and ask for the
  two it does not have. A message that says only "incomplete" sends it
  guessing, and this is the field where guessing means inventing what somebody
  said.

  The reasoning, for whoever reads this cold: B263 and B277 each shipped a
  field an agent was *asked* to send and *allowed* to omit, and in both cases
  it was omitted and the owner was told otherwise. This is the third instance
  of that pattern and the first one caught before it shipped. The remedy for an
  owner who writes in one language is `PATCH /api/v1/<user>/config` with
  `locales: ["de"]` — one call — not a day quietly saved in one language while
  the switcher offers three.

  Make the refusal name that remedy, since an agent hitting it needs to know
  the fix is the journal's languages and not the day.
- **Both documents**, including the day-fields table and the creation question
  B277 added, so an owner choosing three languages is told what it commits them
  to at the moment they choose.

Read `lib/entries.ts` and every day reading path before estimating. The schema
is the small part; the fallback and the search and feed paths are not.
## Acceptance

Either the documents and the creation question say plainly what `locales`
covers, or a day can carry its prose in the journal's declared languages with
a documented fallback — and whichever is chosen, the reasoning is written down
where the next person reads it.

## Before starting

B298 is removing MCP at the owner's request, and this task touches the day
write path that MCP's `create_day` and `edit_day` mirror. Check where B298 has
got to first: if `lib/mcp/tools.ts` is gone, there is one door to change rather
than two, and half the work in the Work section above disappears. If it is not
gone yet, coordinate rather than writing tool schemas that are about to be
deleted.
