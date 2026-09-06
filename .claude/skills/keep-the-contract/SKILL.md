---
name: keep-the-contract
description: Check that /openapi.json and /agent.md still tell the truth after a change to an API route — every field documented, every enum from its source, every accepted field readable back. Use after adding or changing anything under app/api/, when a field "does not seem to work" over the API, or when somebody asks whether the spec is up to date.
---

# Does the document still tell the truth?

**Everybody outside this checkout has the document and nothing else.** There is
no editing interface (ROADMAP decision 24), so an agent writing somebody's
journal over the network reads `/openapi.json` and `/agent.md` and has no
source to fall back on. A field the code accepts and the document does not
mention is a field nobody will ever use. A field the document promises and the
code drops is worse: the caller is told it worked.

Run this after any change under `app/api/`, and before merging anything that
touches a route.

## 1. The mechanical half — the tests already do it

```bash
npx vitest run test/openapi-contract.test.ts test/api-route-schemas.test.ts
```

Between them they fail on:

- a `/api/v1/**` or `/api/auth/**` route+verb that is not in the document
- an `enum` that has drifted from the constant the validator uses
- an operation with no refusal documented beside the success
- a `required` list naming a field that is not in `properties`
- a route that reads a body and publishes no schema

If you added a route and it now fails, that is the test doing its job. Add the
operation; do not add it to an allowlist. The two allowlists that exist —
browser-only flows, and the two `405` signposts from B293 — are named
decisions with reasons written beside them, not a place to put work you did not
want to do.

## 2. The half no test can reach

A test cannot tell you whether a sentence is true. These have all been wrong in
this document, and each one was found by a person or an agent reading it and
believing it:

- `Cost.category` said **"free text"** and is a closed list of seven that
  refuses anything else.
- `GET .../days` said **"published days in a trip"** and returns drafts too.
- The module comment said **"there are five endpoints"** while describing
  thirty.
- `people` said **"nothing can change this afterwards"** next to a `PATCH`
  that changes it.

So read what you wrote, out loud if it helps, and ask of each sentence: *is
this still true of the code as it is now?*

Then the three checks a test cannot make:

**Is every accepted field readable back?** If a write takes it, some documented
`GET` has to show it. Otherwise an agent cannot verify its own work, and "it
was accepted" quietly becomes "it is there" — which is how B540 found
`countryCode` and `tracks` being taken, answered `201`, and thrown away.

**Does the refusal say what to do instead?** A 400 that names a field is
better than one that does not; one that says *did you mean `visibility`?* ends
the conversation. One that says only "invalid" sends an agent back to the
document it already misread.

**Is a limit readable before it is hit?** Sizes, formats, counts — put them
where a caller can ask, not only in the message they get after wasting the
upload. `/api/health` carries the media limits for exactly this reason.

## 3. Drive it, against something running

The bugs that survive both of the above are found by using the API, not by
reading it. Bring an instance up with a scratch content directory and every
capability on:

```bash
export CONTENT_DIR=/tmp/fernscout-contract/content
export DATABASE_URL=sqlite:/tmp/fernscout-contract/db.sqlite
export SESSION_SECRET=whatever-local
export FERNSCOUT_CONFIG=/tmp/fernscout-contract/config.json   # site/config.json with features on
mkdir -p "$CONTENT_DIR" && npm run db:migrate && npm run dev
```

Mail is written to files locally, so the six-digit codes are readable: they
land in `$CONTENT_DIR/.mail/` for a signup and `$CONTENT_DIR/<user>/mail/` for
everything else, base64 inside the `.eml`.

**`"kind": "agent"` on both `/api/auth/request` and `/api/auth/verify`.**
Without it the verify call answers `200` with no token in it — a guest cookie —
and nothing in the response says you asked for the wrong thing.

Then, for the field you changed: **send it, and read it back.** That is the
whole test, and it is the one that keeps finding things.

## 4. The strongest check, when the change is large

Give a subagent the base URL and nothing else — no repository access at all —
and ask it to build a journal from `/agent.md` and `/openapi.json` alone,
recording every point where it had to guess and every field that did not
survive the round trip. Its stumbles are the document's bugs.

That is how the four findings in B540 were caught, and every one of them had
been read past by people who knew the code.

## What is not this skill's job

Do not change behaviour to match a wrong sentence. If the document says
something better than what the code does, that is a capture in `backlog/` and
an argument to have — B553 is a list of exactly those. Fix the sentence, and
say in the task file which one you believe.
