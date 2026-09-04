---
id: B254
title: The landing page hands over a bare URL where an agent needs an instruction
type: ISSUE
priority: high
complexity: low
area: landing page
found: "2026-09-04T10:13:42Z"
started: "2026-09-04T10:14:03Z"
session: 986bc24c-6a18-473f-a506-aa8c4efb475c
claimed: "2026-09-04T10:14:03Z"
---

# B254 — The landing page hands over a bare URL where an agent needs an instruction

## Why

The landing page is the only interface this site has for *starting* a journal:
there is no form, so the string a person pastes into their agent is the
onboarding flow. `components/Landing.tsx:113` copies `docUrl` and nothing else,
under a button labelled `landing.copy` — "Copy link".

Pasted into an agent, a bare URL is an ambiguous instruction. The agent may
fetch it, may summarise it, may ask what to do with it. Nothing in the copied
string says *guide me through creating a journal*, and nothing says the agent
will need an email address the person controls — that requirement is on the
page as prose (`landing.handEmail`, `Landing.tsx:111`) and is exactly the half
that does not survive a copy-paste.

Found in interactive testing on 2026-09-04, driving a real agent from the
landing page: the copied value was the whole of what the agent received.

## Work

- `landing.copy` becomes "Copy instruction" — the button copies a sentence, so
  it must not say "link". Same for `de` and `hu` (`content/locales/`).
- `Landing.tsx` copies an instruction naming the guide's URL and the email
  requirement, from a new locale string with `{url}` interpolated. English
  reads roughly: *Guide me through creating my own travel journal, following
  the documentation at {url}. You will need an email address I control.*
- The visible page text stays as it is — host, path and the email line are
  already readable one at a time, which is what `CopyLine`'s accessible-name
  note asks for. Pass `name` so the button's accessible name says what it
  copies rather than reciting a sentence (B199).
- **Not** touching `components/AgentHandover.tsx`. It is the same button in a
  different situation — an owner who already has a journal, handing over the
  guide plus their own address — and the instruction it wants is "write in my
  journal", not "create one". Capture separately if it needs the same
  treatment.

## Acceptance

- `test/landing.test.tsx` asserts the copied value contains the guide URL and
  the email requirement, and that the button reads "Copy instruction".
- Clipboard value on `/` pastes into an agent as a self-contained instruction:
  no other line from the page is needed to act on it.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
