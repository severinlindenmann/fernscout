---
id: B787
title: The sign-in button may stay disabled when the address is autofilled
type: ISSUE
priority: medium
complexity: low
area: auth, ui
found: "2026-09-07T14:32:47Z"
started: "2026-09-08T19:14:17Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T19:14:17Z"
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

Confirmed in `test/signin-autofill.test.tsx`: writing an input's value
through the DOM's own setter (bypassing React's value tracker, the way
autofill does when it does not synthesize an `input` event) leaves React
state at its initial `""` forever — `onChange` never fires — so
`disabled={busy || email === ""}` never lifts. Reproduced against the
pre-fix code (test failed there, `button().disabled === true`) and fixed
against the current code (test passes).

Fixed the shape everywhere it appeared — `IdentitySignIn.tsx`,
`GuestSignIn.tsx`, and the email+code steps of `SignupWizard.tsx` (its later
steps, e.g. the journal-creation form, are untouched — those fields are
typed, not autofilled addresses or codes, and are out of scope for this
ticket):

- The submit button no longer disables on `email === ""` / `code.length < 6`
  read from React state. The field's own `required` (and, for the six-digit
  code, a new `minLength={6}` alongside the existing `maxLength={6}`) is what
  the browser now uses to refuse a genuinely empty or short submit —
  natively, with the browser's own message pointing at the field, which a
  dead button could never give a reader. This is the "drop the disabled
  state and let the browser validate" remedy the ticket named, and it means
  the button is pressable even when `onChange` never ran.
- `requestCode`/`submitCode` (and `verifyCode` in the wizard) now read the
  submitted value with `new FormData(event.currentTarget).get(...)` rather
  than trusting the React state a stale autofill would leave at `""` — this
  is what stops the request being sent with an empty address even after the
  button becomes pressable. `code` and `email` inputs that lacked a `name`
  attribute (`identity-code`) got one, since `FormData` needs it.
- State (`setEmail`/`setCode`) is still updated from the read value, so the
  code step (which reads `email` from state, not from its own form) keeps
  working.

Not done: nothing needed changing in the code-step's read of `email` in
`IdentitySignIn`/`GuestSignIn`, since that value was already set correctly by
the (now form-read) email step before the code step ever renders.

## Acceptance

- **An address filled by the browser's own autofill can be submitted.**
  Verified in `test/signin-autofill.test.tsx`, which sets `.value` through
  the native setter with no `input`/`change` event dispatched (autofill's
  failure mode) and asserts the send button is not disabled and that the
  actual field value reaches the request body — for both `IdentitySignIn`
  and `GuestSignIn`. Fails against the pre-fix component, passes against the
  fix. The signup wizard's email/code steps share the same code path
  (`FormData` read + no state-derived `disabled`) but were not given their
  own autofill test — `test/signup-wizard.test.tsx`'s existing tests already
  cover the form-read path for other fields via `type_()`. **Real
  browser/device autofill (a phone's saved address, an OS-level password
  manager) is not exercised by any test here** — that half of the ticket's
  "verify first, on a real phone" instruction is not checkable from this
  worktree and is still worth doing before calling this closed.
- A genuinely empty required field still refuses to submit — covered by the
  same test file, asserting `fetch` is never called.
