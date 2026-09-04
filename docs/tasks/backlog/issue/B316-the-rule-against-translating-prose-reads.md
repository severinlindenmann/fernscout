---
id: B316
title: The rule against translating prose reads as absolute, so an agent refuses an owner who asks for it
type: ISSUE
priority: high
complexity: low
area: agent docs, i18n
found: "2026-09-04T16:55:51Z"
---

# B316 — The rule against translating prose reads as absolute, so an agent refuses an owner who asks for it

## Why

B294 shipped this sentence into both documents, and it is mine:

> **The words are the owner's.** Ask them for each language and write what they
> give you; never translate their prose yourself, and never machine-translate
> to get past the refusal — that is inventing what somebody said, which is the
> one thing you may not do.

Within hours it did the wrong thing. An owner with fifteen days written in
English, in a journal declaring `de`, `en` and `hu`, watched an agent stop and
offer two options — reconfigure the journal, or translate the thirty missing
versions by hand. Asked directly to translate, it complied *under protest*:

> Ich muss dich warnen: Die Fernscout-API sagt ausdrücklich, dass die Prosa des
> Eigentümers von diesem selbst kommen muss … Aber: Da du es explizit verlangt
> hast, werde ich es machen.

The owner's verdict: *"for sure the agent can translate for you, that is not an
issue."*

**The rule conflated two different things, and only one of them is forbidden.**
The one rule in AGENTS.md is about *what happened*: no weather nobody
mentioned, no meals nobody ate — because "one invented memory presented to
somebody's family as fact is not recoverable". Translating words the owner
*did* write invents nothing. Nothing is added; the same account is carried into
another language, at the owner's request.

So the prohibition belongs where it started: **unasked**. An agent must not
quietly manufacture three language versions and present them as the owner's
writing. An agent asked to translate should translate, say plainly that it did,
and leave the owner able to correct it.

The current wording also creates the exact pressure it was written to prevent.
An agent facing a refusal it cannot satisfy, and a rule forbidding the only
thing that would satisfy it, is an agent stuck — and the transcript shows the
next move is to argue with its owner rather than to help them.

## Work

`lib/api/agentCopy.ts` — `TRANSLATIONS_REQUIRED`, and check
`COORDINATES_QUESTION` for the same over-reach while you are there (it says an
unconfirmed guess is never written, which is right for a *location* and worth
re-reading in this light).

The sentence has to carry three things without becoming a paragraph:

- **Do not translate unasked.** Three language versions an owner never asked
  for, presented as their writing, is the failure.
- **If they ask, translate.** Say so in as many words, so an agent does not
  read silence as prohibition. It is their journal and their words being
  carried, not invented.
- **Say what you did.** A translated day should be reported as translated, so
  the owner knows which words are theirs and which are yours, and can correct
  them. The write response is the natural place; do not build a `machine:
  true` field on the strength of this ticket alone — say it in the reply and
  capture the field if it turns out to be wanted.

Keep the distinction the rule was reaching for, in one clause: **inventing what
happened is forbidden; carrying what they wrote into another language is not.**

Also worth a line, since it was the agent's first instinct and is good advice:
if the owner would rather not have translations at all, `locales` is one
`PATCH` away — that is already in the refusal (B294) and evidently reads as the
*only* option rather than one of two.

## Acceptance

- An agent reading either document understands it may translate when asked and
  must not when not asked.
- The write path is unchanged — the refusal still names missing languages
  (B294); this is wording, not validation.
- A test asserts the sentence contains both halves, so a future edit cannot
  drop the permission and leave the prohibition.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
