---
id: B1765
title: The handover prompt never shows the auth header, and never says what a failed call means
type: ISSUE
priority: medium
complexity: low
area: Agent copy
found: "2026-09-15T05:47:54Z"
started: "2026-09-15T05:48:11Z"
merged: "2026-09-15T05:56:41Z"
completed: "2026-09-15T08:19:28Z"
---

# B1765 — The handover prompt never shows the auth header, and never says what a failed call means

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Two gaps, both found by watching a real agent fail on the live instance on
2026-09-15 while B1756 was being diagnosed.

**1. Step 2 never shows the header.** `handoverPrompt` (lib/api/agentCopy.ts)
gives step 1 as a complete curl, headers and all, and then step 2 as a bare
`GET {siteUrl}/api/v2/{user}/status`. Nothing in the whole chain says the
7-day token goes in an `Authorization: Bearer` header — not the prompt, and
not the `next` line the handover exchange answers with
(app/api/auth/handover/route.ts). An agent has to infer it. Guess wrong and
the call is a 401, which reads as "the token I was just given is bad" rather
than "I addressed this wrong".

**2. Nothing says what a failed call means.** `buddyPrompt`'s closing
paragraph covers this for refusals, and its own comment says why: B293, where
"no correct call available and nothing saying so" ended with an agent
inventing a web UI. `handoverPrompt` has no equivalent. During B1756 the
status call answered 500 with an empty body and the agent concluded the
endpoint no longer existed — it went looking for another way in rather than
reporting what it got.

`/documentation.txt` makes that guess more likely, not less: "`401` means go
and get a code, `200` means you are in" (lib/api/documentation.ts:123) gives
an agent two cases and no third, so a 5xx gets filled in by whatever the model
thinks is most likely.

## Work

In `lib/api/agentCopy.ts`:

- `handoverPrompt` step 2 becomes a real curl carrying the bearer header,
  matching step 1's shape.
- Both prompts gain one closing line: a failed call is reported and stopped
  on, not routed around.

Leave `buddyPrompt`'s steps alone — it already shows two full curls, so the
header pattern is established there.

This is copy addressed to a machine, so it stays English regardless of locale,
for the reason the existing comments give. Severin approved the wording on
2026-09-15.

## Acceptance

- The prompt rendered at `/{user}/me` shows an `Authorization: Bearer` header
  on the status call.
- Both prompts tell an agent to report a failure rather than look for another
  way in.
- A test asserts both, so neither can be edited back out silently.
- `npm run verify` green.

## Revalidation — valid

Both gaps confirmed by reading `lib/api/agentCopy.ts` on `main` at 9e8c5ce7:
`handoverPrompt` step 2 was a bare `GET ${siteUrl}/api/v2/${username}/status`
with no header anywhere in the prompt, and its closing paragraph had no
equivalent of `buddyPrompt`'s refusal line. Neither prompt had a test.

## What was done

- `handoverPrompt` step 2 is a full `curl` carrying
  `-H "Authorization: Bearer <the token step 1 gave you>"`, matching step 1's
  shape, with two words saying it is the same header the key used.
- Both prompts close with: *If a call fails, tell me what it answered and
  stop. Do not look for another way in — there isn't one, and a failure here
  is mine to fix.*
- The doc comment on `handoverPrompt` records both reasons (B1756's empty 500,
  and the header that was nowhere in the chain).
- New `test/agent-prompts.test.ts` — the first test either prompt has ever
  had, which is how both gaps survived. It asserts the header is the line
  directly under the status URL, not merely present somewhere in the prompt.

`buddyPrompt`'s steps are untouched: it already shows two complete curls, so
the header pattern is established there.

## Acceptance

- Header on the status call: asserted by position, and the assertion fails
  when the bare `GET` form is put back (`expected '' to contain
  'Authorization: Bearer'`).
- Failure line in both prompts: asserted for each.
- `npm run verify` green.
- Checked on the rendered page at desktop and phone width after deploy.
