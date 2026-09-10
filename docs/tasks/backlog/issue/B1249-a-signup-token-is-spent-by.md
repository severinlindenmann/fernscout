---
id: B1249
title: A signup token is spent by a creation that failed, so the person cannot retry at all
type: ISSUE
priority: high
complexity: low
area: signup, auth
found: "2026-09-10T09:44:50Z"
---

# B1249 — A signup token is spent by a creation that failed, so the person cannot retry at all
## Why

The wizard's create call failed with a server-side `EACCES` (B1246). Pressing
the button again answered:

> A signup token creates one journal and is spent by doing so. If you have
> already created one, that succeeded — do not retry, and use the agent token it
> gave you. Otherwise this token has expired (they last twenty minutes): start
> again at POST /api/auth/signup/request.

No journal had been created. The token was spent by a call that created nothing,
so the only path forward for the person in front of the wizard is to go back to
the beginning, request a second code, read a second email, and retype the whole
form — for a failure on the server's side, and with no way to know that is what
happened.

Single use is the right property for a signup token; being spent by a failure is
not. The claim it makes is also false in this case — "If you have already
created one, that succeeded" — which is the kind of sentence
`lib/helper/model.ts` exists to stop a model saying, arriving here from a route
instead.

## Work

- Spend the token when the journal is actually created, not when the attempt
  begins. Where the create is not atomic, release it on the failure path.
- Keep it single use against a *successful* create; that is the property worth
  keeping.
- The wording of the refusal is B1250; the message it produced is only the
  symptom here.

## Acceptance

- A create call that fails on the server leaves the token spendable: pressing
  the button again after the cause is fixed creates the journal.
- A create call that succeeds still refuses a second use.
