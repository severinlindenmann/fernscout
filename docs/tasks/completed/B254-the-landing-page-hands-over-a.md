---
id: B254
title: The landing page hands over a bare URL where an agent needs an instruction
type: ISSUE
priority: high
complexity: low
area: landing page
found: "2026-09-04T10:13:42Z"
started: "2026-09-04T10:14:03Z"
merged: "2026-09-04T10:19:48Z"
completed: "2026-09-05T09:28:01Z"
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

- The button label becomes "Copy instruction" — the button copies a sentence,
  so it must not say "link". In all three locales (`content/locales/`).

  Built as a **new** key, `landing.copyInstruction`, rather than by changing
  `landing.copy` as this section first said. `landing.copy` has three callers,
  not one: `Landing.tsx`, `AgentHandover.tsx` and `InviteLinks.tsx:182`, and
  the last of those copies a guest or buddy invite URL, where "Copy link" is
  exactly right and "Copy instruction" would be false. Renaming the shared
  value would also have relabelled `AgentHandover` — the one file this ticket
  says not to touch. So `landing.copy` keeps its wording and its two link
  callers, and the landing page gets its own label.
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

  The clipboard value lives in the click handler and this suite renders to
  static markup under `environment: "node"`, so there is nothing to click: the
  sentence is asserted from the dictionary the component interpolates, the
  button and its accessible name from the markup. Same split as B199's tests.
- Clipboard value on `/` pastes into an agent as a self-contained instruction:
  no other line from the page is needed to act on it.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
