---
id: B255
title: The landing page's handover block shows one thing and copies another
type: ISSUE
priority: high
complexity: low
area: landing page
found: "2026-09-04T10:25:39Z"
started: "2026-09-04T10:25:56Z"
merged: "2026-09-04T10:29:28Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-05T09:14:25Z"
---

# B255 — The landing page's handover block shows one thing and copies another

## Why

B254 made the copy button hand over a sentence. The block above it still shows
a postal-style address and a fragment of prose:

```
fernscout.ch
/documentation.txt

and an email address you control
```

while the clipboard now carries

```
Guide me through creating my own travel journal, following the documentation
at https://fernscout.ch/documentation.txt. You will need an email address I
control.
```

Two different things under one heading, and the button is the only place the
real instruction exists. A person reading the page cannot tell what they are
about to paste; a person who cannot use the clipboard — refused permission,
a screen reader, a phone in a hostel — has to reconstruct the sentence from a
two-line address and a sentence fragment, and will not.

`components/Landing.tsx:107-113`.

## Work

- The handover block renders **the instruction itself** as its visible text —
  the same string, from the same locale key, that `CopyLine` copies. One value,
  interpolated once, used twice.
- The two-line host/path presentation and `landing.handEmail` go: they exist to
  say what the copied value was, and the copied value now says it. Drop the
  keys from all three locales if nothing else uses them, and re-run
  `npm run i18n:keys`.
- Keep it readable as a block of mono text at phone width — a long URL must not
  force horizontal scroll. `break-words` or equivalent; no new component.
- With visible and copied text identical, `CopyLine`'s `name` override is no
  longer covering a mismatch. Leave it as "Copy instruction" anyway: an
  accessible name that recites a whole sentence is worse than one that says
  what the button does, which is B199's finding.

## Acceptance

- `test/landing.test.tsx` asserts the rendered markup contains the same
  instruction string the button copies, with the URL interpolated.
- Nothing on `/` states the guide's address or the email requirement in a form
  other than the instruction.
- No horizontal scroll on the section at 375px.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
