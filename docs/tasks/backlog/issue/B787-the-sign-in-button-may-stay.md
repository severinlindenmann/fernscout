---
id: B787
title: The sign-in button may stay disabled when the address is autofilled
type: ISSUE
priority: medium
complexity: low
area: auth, ui
found: "2026-09-07T14:32:47Z"
---

# B787 — The sign-in button may stay disabled when the address is autofilled

## Why

`components/IdentitySignIn.tsx:205` — the submit button is
`disabled={busy || email === ""}`, where `email` is React state fed by
`onChange`.

Filling the field programmatically in a browser and pressing Enter left the
button disabled with a valid address in it, and the form did not submit. I
could not tell from outside whether the automation dispatched a real input
event, so **this is a suspicion, not a confirmed bug** — and it is worth ten
minutes because of who it would hit.

React's synthetic `onChange` does not fire when something sets `.value`
directly. Chrome's own autofill normally does fire it; some password managers
and some assistive tooling do not. The population most likely to have their
address saved and filled for them is exactly the population this screen exists
for — somebody older, on a phone their family set up.

If it is real, the symptom is the worst kind: the field looks filled, the
button looks dead, and there is nothing to read.

## Work

Verify first, on a real phone with a saved address, before changing anything.
If it reproduces, the usual remedies are to read the value from the form on
submit rather than from state, or to drop the disabled state and validate on
press with a message.

Check the code field and the signup form for the same shape.

## Acceptance

An address filled by the browser's own autofill can be submitted.
