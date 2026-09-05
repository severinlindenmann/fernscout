---
id: B448
title: The notifications heading on /me stands over an empty box where push cannot work
type: ISSUE
priority: low
complexity: low
area: push, me page
found: "2026-09-05T12:36:21Z"
started: "2026-09-05T13:41:24Z"
session: f20cc410-8085-4b17-accd-9280089147b4
claimed: "2026-09-05T13:41:24Z"
---

# B448 — The notifications heading on /me stands over an empty box where push cannot work

## Why

`app/[user]/me/MePageContent.tsx:799` renders the Notifications section
unconditionally — heading, lede, and `<PushOptIn>` — and its own comment says
the opposite: *"there is no case where this heading stands over an empty box:
the whole section is conditional on the same answer"*. It is not. `PushOptIn`
returns `null` for `checking` and for `unsupported`, and the section around it
is rendered either way.

So a reader whose browser cannot subscribe, or whose journal has push switched
off, gets a heading and a paragraph promising notifications "on this device"
with no control under it and nothing saying why. `unsupported` is also what
this component falls back to on any unexpected error, which makes the empty box
the failure mode of everything above it.

A comment asserting a guard that does not exist is the part worth fixing
carefully: the next person to read it will believe it.

## Work

- Decide where the condition lives. `PushOptIn` knows the answer and the
  section does not, so either it renders its own heading and lede, or it hands
  the parent a "nothing to show" signal.
- Correct or delete the comment either way.

Not doing: showing an explanation in place of the switch. What to say to
somebody on a browser with no push at all is a separate question and probably
"nothing".

## Acceptance

- With push disabled for a journal, `/<user>/me` shows no Notifications
  heading.
- `npm run verify`.
