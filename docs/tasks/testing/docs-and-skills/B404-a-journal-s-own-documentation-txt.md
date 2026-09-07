---
id: B404
title: A journal's own documentation.txt does not say a private trip stays shut to approved guests
type: DOCS
priority: low
complexity: low
area: agent guide
found: "2026-09-05T07:38:27Z"
started: "2026-09-07T10:37:30Z"
merged: "2026-09-07T11:00:35Z"
---

# B404 — A journal's own documentation.txt does not say a private trip stays shut to approved guests

## Why

Found while verifying B302, which passed: `/agent.md` and `/documentation.txt`
both now offer the three-way visibility choice and both carry the consequence
sentence -- "A private trip stays shut to approved guests too -- approving
somebody into the journal does not open it."

The **per-journal** document, `/<user>/documentation.txt`, does not. It says
only that trip creation "defaults to this journal's own visibility."

B302's Work section asks for this document to be checked; its Acceptance does
not name it, which is why B302 passed. But an agent handed one journal's own
summary -- which is a normal way in -- gets the framing without the warning,
and the warning is the whole of what B302 was about.

Verified on fernscout.ch, 2026-09-05.

## Work

Carry the same consequence sentence into the per-journal document, from the
shared copy the other two already read from rather than a fourth restatement.

## Acceptance

`curl -s https://fernscout.ch/<user>/documentation.txt` contains the
private-shuts-out-guests sentence.

## Done, 2026-09-07

Added `...wrap(PRIVATE_SHUTS_OUT_GUESTS.replace(/\`/g, ""), 78)` to
`userDocumentation()` in `lib/api/documentation.ts`, right after the
Endpoints list and before "## The guide" — reading from the same
`lib/api/agentCopy.ts` constant `instanceDocumentation()` and `agentGuide()`
already use, per the Work section's ask, rather than a fourth restatement.
Backticks stripped the same way `instanceDocumentation()` already does its
own copy of this sentence, since this document is served as plain text
(`app/[user]/documentation.txt/route.ts`).

`npm run verify` passed.
