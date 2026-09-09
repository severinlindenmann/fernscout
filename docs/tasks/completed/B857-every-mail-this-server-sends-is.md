---
id: B857
title: Every mail this server sends is English whatever language the reader chose
type: ISSUE
priority: high
complexity: medium
area: mail, i18n
found: "2026-09-07T17:11:05Z"
started: "2026-09-07T18:41:35Z"
merged: "2026-09-07T19:07:23Z"
completed: "2026-09-09T16:47:06Z"
---

# B857 — Every mail this server sends is English whatever language the reader chose

## Why

A Hungarian tester signed up on the live instance with `accept-language: hu`
throughout, and a journal whose `defaultLocale` is `hu` on record. **Every mail
the server sent her was entirely in English** — subject and body, plain text and
HTML:

- *"Your code to start a journal on Fernscout"* — *"Start a journal / Your code
  is 839182…"*
- *"Your Fernscout agent code"* — sent after the journal existed, with `hu` on
  file
- *"Sign in to Eszter balkáni útja"* — the journal's own Hungarian title is
  interpolated correctly into an English wrapper

Asked where she would stop, she said: **at the first mail.**

> "It is pure English. In real life I'd have had to send it to someone to
> translate before I could even find my six-digit code."

The `/agent` page itself is fully Hungarian, the published day is correctly
bilingual, and the ask box answered her in fluent Hungarian. **The content layer
is solid; the layer that gets somebody into it is not localised at all.**

This also contradicts what the software says about itself. `/agent.md` tells an
agent that `defaultLocale` "sets the language of the site's own chrome and of
the mail this server sends the owner — including the letter that arrives the
moment the journal is created, **which is the first thing the software ever says
to them**".

## Work

Send mail in the recipient's language: `accept-language` before a journal
exists, the journal's `defaultLocale` once one does. The templates are in
`lib/mail/` and the code routes in `app/api/auth/*/request/`.

Start with the three that gate everything — the signup code, the agent code and
the sign-in code. A person who cannot read those never reaches anything else.

Then audit the rest, and fix `/agent.md` if any mail is going to stay English,
because at the moment the document promises something the code does not do.

## Acceptance

A Hungarian journal's owner receives Hungarian mail, starting with the code
that lets her in.
