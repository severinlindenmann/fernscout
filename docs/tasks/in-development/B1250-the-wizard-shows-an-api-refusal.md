---
id: B1250
title: The wizard shows an API refusal naming HTTP endpoints to somebody who has no agent
type: ISSUE
priority: high
complexity: low
area: signup, helper
found: "2026-09-10T09:44:55Z"
started: "2026-09-11T08:26:06Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T08:26:06Z"
---

# B1250 — The wizard shows an API refusal naming HTTP endpoints to somebody who has no agent
## Why

`/agent` exists for the person who has no agent of their own — that is what
AGENTS.md says it is for, and the wizard's own copy promises *"Nobody will ask
you to fill in a form again after this."* When journal creation was refused, it
showed them this:

> A signup token creates one journal and is spent by doing so. If you have
> already created one, that succeeded — do not retry, and use the agent token it
> gave you. Otherwise this token has expired (they last twenty minutes): start
> again at POST /api/auth/signup/request.

Every noun in it belongs to the API guide: *signup token*, *agent token*, *POST
/api/auth/signup/request*. It is a good refusal for an agent reading
`/agent.md`, and it is unreadable for the reader this door was built for. The
route's `error` string is being rendered straight into the page.

There is precedent for the shape of the fix: `That did not work: unknown`
(B1247) is the same rendering path, one refusal further along.

## Work

- Refusals the wizard can actually meet get a sentence of their own, in the
  person's language, in `site/locales/*.json` — three files and
  `npm run i18n:keys`, and real German and Hungarian rather than a machine
  guess.
- Keep the API's own wording for the API. The route is right to say what it
  says; the wizard is wrong to repeat it.
- Where no mapping exists, the fallback should still be a sentence a person can
  act on, not an error string.

## Acceptance

- Driving the wizard into a refused create shows no endpoint path, no HTTP verb
  and no mention of a token.
- The same refusal over `POST /api/v1/journals` is unchanged.
