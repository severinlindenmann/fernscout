---
id: B838
title: The helper never asks which languages a journal is written in
type: ISSUE
priority: high
complexity: low
area: agent, signup, i18n
found: "2026-09-07T16:07:36Z"
started: "2026-09-07T16:22:32Z"
merged: "2026-09-07T16:55:14Z"
completed: "2026-09-09T16:46:24Z"
---

# B838 — The helper never asks which languages a journal is written in

## Why

`/agent.md` opens the onboarding section with "This is a script, not a menu:
ask all seven of the questions below, in order, once, before your first call.
Do not start on a guess." The helper's signup asks four and a half of them.

`components/SignupWizard.tsx:72` — `const [defaultLocale] = useState(…)`, with
**no setter**. It is taken from the browser's locale and never asked.
Line 139 — `locales: [defaultLocale]`, hardcoded to the one.

The guide is explicit about why both matter, and about what happens without the
second:

> Which languages a reader may switch the journal into — **a different question
> from the one above**… Required — a journal created without it has no language
> switcher at all, **which is how one asked for three languages ended up with
> one (B277)**.

So every journal the helper creates reproduces B277 by construction, and a
German-speaking owner whose phone is in English — which is the exact person
tested twice in this project, because families set these phones up — gets an
English journal without being asked.

The guide also says what the answer commits somebody to, and that has to be
said on the screen rather than assumed: every day of every trip is then written
in all of them, in their own words, and a day missing one is refused (B294).
Two languages is a promise to write everything twice. One is the honest answer
and can be widened later.

## Work

Ask both, in the signup wizard, in plain words:

- which language do you write in? (`defaultLocale`)
- may a reader switch it into another? (`locales`) — with the sentence about
  what that promises, and one as the honest default.

The instance maintains `en`, `de`, `hu` (`MAINTAINED_LOCALES`), which B777 now
validates on both routes.

Then audit the rest of the script against the wizard, and write the comparison
into the component so the next person can see which questions it is answerable
for.

## Acceptance

A German speaker on an English phone gets a German journal because they were
asked, and a journal created in the helper has a language switcher if its owner
wanted one.
