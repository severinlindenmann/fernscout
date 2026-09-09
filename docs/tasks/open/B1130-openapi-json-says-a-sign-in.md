---
id: B1130
title: openapi.json says a sign-in code lasts ten minutes and agent.md says thirty; the code says thirty
type: ISSUE
priority: medium
complexity: low
area: api, docs, auth
found: "2026-09-09T17:59:42Z"
---

# B1130 — openapi.json says a sign-in code lasts ten minutes and agent.md says thirty; the code says thirty

Found during B103, driven against fernscout.ch on 2026-09-09.

## Why

One server, two documents, two different numbers:

- `https://fernscout.ch/openapi.json` — `code`: *"Six digits. Ten minutes,
  single use."* (`lib/api/openapi.ts:785`)
- `https://fernscout.ch/agent.md` line 348 — *"30 minutes, is single use, and
  burns after five wrong guesses."*

`CODE_TTL_MS` in `lib/auth/index.ts:61` is `30 * 60 * 1000`, and the mail that
arrives says so too ("Your code is 086718. It works for 30 minutes."), so
`agent.md` is the one telling the truth. `lib/auth/index.ts:67` already says in
prose that the number is written out in words in several places and that
`agent.md` is one of them — the OpenAPI copy was missed.

Ten minutes was the *old* value, and it was lengthened deliberately (the
comment at `lib/auth/index.ts:51` says why). So this is not a rounding
difference: the document tells an agent the person has a third of the time
they actually have, which is exactly the pressure B40 existed to remove.

## Work

Replace the literal in `lib/api/openapi.ts:785` with `CODE_TTL_MINUTES` —
already exported from `lib/auth/index.ts:72`, and exported *for this*. Do not
write "thirty" back in by hand; a second literal beside the constant is the
same bug again with a different number.

Check the rest of the document for the same shape while you are there: any
other duration or count in `openapi.ts` that is typed rather than imported.

## Acceptance

- `curl -s https://fernscout.ch/openapi.json | grep -o 'Six digits[^"]*'` names
  thirty minutes, or names no number at all.
- The string is derived from `CODE_TTL_MINUTES`, not typed.
