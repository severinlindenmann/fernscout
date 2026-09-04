---
id: B263
title: Journal creation silently defaults visibility and language, so a journal asked to be private was created public
type: SECURITY
priority: high
complexity: low
area: api, journals
found: "2026-09-04T11:26:21Z"
started: "2026-09-04T11:27:17Z"
merged: "2026-09-04T11:44:18Z"
---

# B263 — Journal creation silently defaults visibility and language, so a journal asked to be private was created public

## Why

Observed on 2026-09-04 on fernscout.ch. An owner asked a Haiku-class agent for
a **private** journal in **German**. The agent asked both questions, got both
answers, and reported back:

> - Status: Private, accessible to you
> - Languages: Deutsch (default), with English and Magyar available to readers

What is on disk in `content/viki/config.json`:

```json
{"title": "Viktorias Travels",
 "owner": {"name": "Viktoria", "nickname": "viki", "email": "…"},
 "defaultLocale": "en",
 "locales": ["en"]}
```

No `visibility` line at all — which reads as **public**. The journal is listed
on `/documentation.txt` right now, as *"Viktorias Travels — 0 public trips"*,
against its owner's stated wish. The welcome mail — the first thing this
software ever says to her — arrived in English. That was the reported symptom;
it is downstream of this, and B26 already made `sendWelcome` honour the
journal's locale correctly (`app/api/v1/journals/route.ts:249`).

**The server accepted silence on both fields.** `createJournal`
(`lib/journals.ts:224-227`) writes `visibility` only when the input says
`private`, and falls back to `defaultLocale: "en"`. So an agent that omits a
field gets a journal that contradicts what its owner asked for, a `201`, and no
indication anything was decided on its behalf.

The endpoint already knows this argument and applies it to exactly one field.
`app/api/v1/journals/route.ts:145-158` refuses an unrecognised `visibility`
rather than reading it as public, with the reason written out:

> *Refused rather than quietly read as `public`: this is the field that decides
> whether a stranger can come across somebody's journal, and an agent that sent
> "hidden" or "unlisted" meant to ask for something.*

Every word of that applies to the field being **absent**, which is the case
that actually happened. And both documents state plainly that these are
questions with no default anybody may pick — `firstQuestions()` in
`lib/api/agentCopy.ts` says *"none has a default you should pick for them"* —
while the API it documents picks them. The documentation is not wrong about
what should happen; the code disagrees with it.

The response does carry `visibility: created.visibility` (`route.ts:296`), so
the truth was available. A weak agent did not read it and reported its own
intention as fact instead. That is worth knowing about agents, and it is why
the fix cannot be "say it better in the reply" — the field has to be
impossible to omit.

## Work

- **`visibility` and `defaultLocale` become required** on
  `POST /api/v1/journals`, refused with `400 invalid_request` when absent, in
  the voice of the existing refusal beside them: name the question the agent
  was supposed to ask and why nobody else can answer it. Keep the existing
  refusal for an unrecognised *value*.
- **Validate `defaultLocale` against the maintained set** rather than storing
  whatever string arrives. `"Deutsch"`, `"German"` and `"de-DE"` are all things
  an agent will send, and a journal whose `defaultLocale` is not a locale this
  build ships is a journal that renders in English while claiming otherwise.
  Refuse with the codes listed, the way `LOCALE_LIST` already names them.
  Apply the same check to each entry of `locales` if it is not already made.
- `locales` **stays optional** — defaulting it to `[defaultLocale]` is a real
  default and not a decision taken on somebody's behalf.
- Update `/openapi.json` and both generated documents so required means
  required in all three places. `lib/api/agentCopy.ts` is where the shared
  sentence belongs.
- Check the MCP `create_journal` tool, if there is one, takes the same path —
  a door that still accepts silence makes the fix half a fix.

Not in scope: whether an existing journal's visibility can be corrected
afterwards, and the `nickname: "viki"` above, where the agent sent the username
instead of the name it had been given. The server must not guess a nickname, so
there is nothing here to enforce.

## Acceptance

- `POST /api/v1/journals` without `visibility` is `400`, and says which
  question to ask; the same without `defaultLocale`.
- `POST` with `"defaultLocale": "Deutsch"` is `400` naming the accepted codes.
- A journal created with `"visibility": "private"` has the line on disk and
  does not appear on `/documentation.txt`.
- A journal created with `"defaultLocale": "de"` has a German welcome mail in
  `content/<user>/mail/`.
- Tests for each of the four above.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
