---
id: B326
title: Nothing says which language a day's own title and content must be in, so an agent sent the wrong one fifteen times
type: ISSUE
priority: high
complexity: low
area: api errors, i18n
found: "2026-09-04T18:33:02Z"
started: "2026-09-04T18:33:33Z"
merged: "2026-09-04T18:38:18Z"
completed: "2026-09-05T08:31:03Z"
---

# B326 — Nothing says which language a day's own title and content must be in, so an agent sent the wrong one fifteen times

## Why

Observed 2026-09-04. A journal with `defaultLocale: de` and
`locales: ["de","en","hu"]`. An agent working from a travel journal written in
**English** built each day as:

```json
{"title": "Bangkok", "content": "<English prose>",
 "translations": {"en": {…English…}, "de": {…German…}, "hu": {…Hungarian…}}}
```

Fifteen days, fifteen `invalid_entry`, and it took a separate debugging round
before the agent worked out what was wrong:

> Ah! Ich verstehe jetzt. Das Journal ist auf Deutsch (defaultLocale), also
> sollte der Tag auf Deutsch sein, nicht Englisch!

It had it backwards in a way nothing told it. **A day's own `title` and
`content` are the `defaultLocale` version** — they are not "the source
language" or "whatever you have"; they are specifically German here. The
English belongs in `translations.en`, and `de` must not appear in
`translations` at all because the day's own fields already hold it.

Every piece of that is true today and none of it is said. `TRANSLATIONS_REQUIRED`
(B294, reworded by B316) explains what `translations` covers and never names
which language the day's own two fields are in. And the refusal an agent
actually hits is `lib/validate/entry.ts:414-419`:

> `translations.de` — expected: *not `de` — that is the language the day's own
> title and content are in*

Accurate, and it answers a question the agent was not asking. It says "remove
`de` from this block" when the agent's real error was that its **prose was in
the wrong language**. Deleting `de` from `translations`, as that message
invites, would have produced a German journal full of English days with the
German thrown away — worse than the refusal.

The deeper reason this is worth fixing properly rather than tweaking: an agent
holding English source prose for a German journal has to *swap* which text
goes where. That is a genuinely counter-intuitive move, and a refusal that does
not name it leaves the agent to guess — which here cost fifteen failed calls
and a debugging detour, and could equally have ended with the German silently
discarded.

## Work

Say which language each slot holds, in the two places an agent meets the
question.

1. **`TRANSLATIONS_REQUIRED` in `lib/api/agentCopy.ts`** — one clause naming
   the day's own fields as the journal's `defaultLocale`, before it describes
   `translations`. Something to the effect of: the day's `title` and `content`
   are in the journal's own language; `translations` holds the others. Keep it
   to a clause — B308 is open and this file has grown all day.
2. **The `translations.<writtenLocale>` refusal** — say what to do, not only
   what is wrong. It should name the journal's language, say the day's own
   fields are where that version goes, and say plainly that prose in another
   language belongs under that language's key. An agent that has just been
   refused should be able to fix the payload from the message alone.
3. **Consider a refusal for the case that actually happened** and is currently
   invisible: `content` present, `translations` containing `<defaultLocale>`.
   That combination is a strong signal the two are swapped — the agent has
   the right words, in the wrong slots — and naming it directly would have
   turned fifteen failures into one. Only add it if it can be detected without
   guessing; a language cannot be sniffed from text, but *`translations`
   naming the written locale while `content` is also present* is a structural
   tell, not a guess.

Not in scope: detecting what language prose is actually in. That is not
knowable and must not be attempted — an agent whose German is in the wrong
field is a payload problem, not a content problem.

## Acceptance

- Both documents name the language a day's own `title` and `content` are in.
- The refusal for a translation in the written locale tells the caller where
  that version belongs and where their other-language prose belongs.
- A test asserts the refusal names the journal's `defaultLocale`, so the
  message cannot go back to being generic.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
