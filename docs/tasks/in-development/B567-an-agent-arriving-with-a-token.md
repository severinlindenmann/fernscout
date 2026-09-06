---
id: B567
title: An agent arriving with a token has no advertised first call
type: DOCS
priority: medium
complexity: low
area: agent.md, documentation
found: "2026-09-06T21:10:00Z"
started: "2026-09-06T11:10:50Z"
session: 73b1a7f5-30ec-425d-9dbf-4d423e411c0d
claimed: "2026-09-06T11:10:50Z"
---

# B567 — An agent arriving with a token has no advertised first call

## Why

An agent was handed a site address, a journal name and a token, with no notes,
and asked *"check where my journal is up to and finish anything half done"* —
the takeover case, which is at least as common as the create case and had never
been tested.

It went well, and the reason is `GET /api/v1/<user>/status`: one call told it
the journal, every trip, and — decisively — the drafts, each with the URL that
would publish it and a `next` saying in words *"tell the person what is waiting
and ask which to publish. Never publish because it looks finished."* It stopped
and asked. That is the design working exactly as intended.

What went wrong is how nearly it did not find that call:

> *"`/documentation.txt` — one of the two entry points I was pointed at — is
> written almost entirely for the journal-creation flow: a seven-question
> script, signup calls, 'Journals: (none yet)'. For a takeover it is the wrong
> door; nothing on it says 'already holding a token? call `/status` first'.
> `GET /api/v1/<user>/status` is buried in agent.md's route table with a
> one-line description. It turned out to be exactly the right first call — it
> should be the advertised first call for any agent arriving with an existing
> token, and currently you find it only if you read the whole guide."*

Two smaller things the same run found:

- **The owner's address is not discoverable, and nothing says it will not be.**
  If a token expires, the agent cannot work out which address owns the journal
  to ask for a new code. Not telling it is right; not *saying* so leaves it
  hunting for a call that does not exist.
- **On a costs-tracking trip, `costs` is effectively required at write time**,
  and the day script lists it as question six of seven like any other. The 422
  is excellent and self-correcting, but being refused is a worse way to learn
  it than being told.

## Work

- A short block at the top of `/documentation.txt` and near the top of
  `/agent.md`: **already holding a token? `GET /api/v1/<user>/status` first.**
  Say what it answers — where you stand, what is waiting, what to do next —
  because that is what makes it worth calling before anything else.
- Say plainly that the owner's address is never returned by any call, and that
  a lost token means asking the person for the address rather than looking for
  an endpoint.
- In the day script, say that a trip tracking costs will refuse a day that
  says nothing about them, and name the three answers there rather than only
  in the refusal.

Not doing: changing `/status` itself. It is already the right call and its
`next` field is already the right sentence — this is entirely about a reader
finding it.

## Acceptance

- `/documentation.txt` names `/api/v1/<user>/status` as the first call for an
  agent that already holds a token, above the signup material.
- `/agent.md` says the owner's address is returned by nothing.
- The day section names the three costs answers before the refusal does.
- `npm run verify` green.
