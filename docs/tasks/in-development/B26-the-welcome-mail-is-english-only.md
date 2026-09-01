---
id: B26
title: The welcome mail is English only, and nobody is asked which language the journal is in
type: FEATURE
priority: medium
complexity: low
area: mail, i18n, journals
found: "2026-09-01"
started: "2026-09-01"
---

# B26 — The welcome mail is English only, and nobody is asked which language the journal is in

## Why

`sendWelcome` in `lib/journals.ts` builds its blocks as English string literals.
The instance maintains three languages — `content/locales/{en,de,hu}.json` — and
a journal declares `defaultLocale` and `locales` in its own config, so a German
journal's owner gets a German site and an English letter about it. It is the
first thing the software ever says to them, and it is the one piece of it they
did not choose the language of.

The other half is upstream of the mail. `POST /api/v1/journals` accepts
`defaultLocale` and `locales` (they are in `openapi.json`), but the four
questions an agent is told to ask — `firstQuestions` in `lib/api/agentCopy.ts` —
do not include language, and `agent.md`'s worked example omits it. So an agent
following the guide creates every journal as `en` without ever raising the
question, and the mail would have nothing better to use even if it could.

Not the same problem as the digest, which already writes in the reader's
language and passes its own `unsubscribeLabel` — the machinery exists, this mail
just does not use it.

## Work

- Add language to `firstQuestions`, so both `/documentation.txt` and `/agent.md`
  ask it. Say which languages this instance actually maintains rather than
  inviting a free-text answer: read the list from `MAINTAINED_LOCALES` rather
  than typing it into prose, the way the media limits table already does.
- Have `sendWelcome` take the journal's `defaultLocale` and render through the
  locale dictionaries. That means new keys in all three locale files and a
  `npm run i18n:keys` run.
- The footer's small print follows the body's language, as the digest's does —
  an English "Sent by …" under a Hungarian letter is the seam that sends
  somebody to the spam button.

Not doing: translating `agent.md` or `documentation.txt`. Those are read by
agents, and the instance's own operator language is a separate question.

## What was found while building it

The **Why** held up. Two things it did not anticipate:

`translateIn` falls back to the English dictionary for any locale it has no
file for, so `sendWelcome` needed no guard of its own for a journal declaring a
fourth language — it gets a readable English letter rather than a page of
missing keys. Recorded because the obvious defensive check would be dead code.

The existing welcome-mail test decoded the message by splitting on blank lines,
which happens to work for some base64 payloads and produces mojibake for
others — it decoded the English body cleanly and the German one as garbage.
Replaced with `mailBodyOf`, which parses by MIME boundary. That was a latent
bug in the test, not in the mail: nothing was ever wrong with what was sent.

Scope held: the fifth question ("which language") went into `firstQuestions`,
so it is asked once and rendered by both `/documentation.txt` and `/agent.md`
in their own shapes, rather than written into either by hand.

## Acceptance

- Creating a journal with `"defaultLocale": "de"` produces a `.eml` under
  `content/<user>/mail/` whose body is German, footer included.
- `defaultLocale` absent still produces English, and no existing test changes.
- `/agent.md` and `/documentation.txt` both ask which language, and name the
  languages this instance maintains.
- A locale key added for this mail exists in `en`, `de` and `hu`; the i18n key
  test passes without a hand edit to `lib/i18n.ts`.
