---
id: B292
title: Four things an agent had to learn by failing are documented somewhere it was not looking
type: DOCS
priority: medium
complexity: low
area: agent docs, api errors
found: "2026-09-04T13:35:46Z"
started: "2026-09-04T13:37:08Z"
merged: "2026-09-04T13:50:43Z"
---

# B292 — Four things an agent had to learn by failing are documented somewhere it was not looking

## Why

A structured report from an agent that built a fifteen-day trip through the
documented API on 2026-09-04. None of these blocked it; each cost a wasted
round-trip. Two of its four claims turned out to be wrong about the code, and
those two are the more interesting ones — the information was there and the
agent did not find it, which is a documentation defect rather than a missing
feature.

**1. Duplicate day titles collide on the slug.** Two "Bangkok" days in one
trip: the second `POST .../days` is refused because the slug comes from the
title. *This is already documented* — `agent.md`: *"The slug comes from the
title, and no two days in a trip may share one."* What is missing is the advice
that follows from it, which is what an agent actually needs at the moment it is
titling fifteen days from a journal: give each a distinguishing title
(`Bangkok — Arrival`, `Bangkok — Night Market`). The rule is stated; the
consequence for how you name things is not.

**2. `idempotency_key_reused` does not say whether the original write
succeeded.** `app/api/v1/[user]/trips/[trip]/days/route.ts:107-118`. The
message says the key "was already used for a different day, so nothing was
written" — true about *this* call and silent about the one that owns the key.
Since `remember` only records a **successful** result (`lib/mcp/idempotency.ts`
is explicit: *"the first successful result under that key"*), a conflict proves
the original write landed, and the store holds its slug. So the answer the
agent had to go and GET is already in hand and can simply be said.

**3. The media endpoint is documented, but not where an agent writing a day is
reading.** The literal request shape is in `agent.md` (the media section, with
the multipart example). But the day-fields table says only *"Photographs go to
the media endpoint, which puts them in the day for you"* — no path, no link. So
an agent that has just written a day guesses `POST .../days/{slug}/photos`,
gets a 404, and hunts. Name the endpoint at the point of that sentence.

**4. The multipart field name *is* named, and the agent missed it.**
`lib/api/media.ts:175` answers
`{"field": "files", "got": "nothing", "expected": "at least one file"}`. The
agent reported that the error "doesn't name the expected field" — it does, in
the `field` key of a `problems` triple. That a capable agent read past it is
the finding: every other refusal in this codebase carries a `hint` sentence,
and this one carries only a structured triple. **Do not add field aliases** —
accepting `image`, `file` and `files` widens the surface to paper over a
message that can simply be a sentence.

## Work

All four are small and touch the two generated documents plus two error
messages. `lib/api/agentCopy.ts` for anything both documents need.

1. Add the titling advice beside the existing slug rule, with the worked
   example. Keep it to a sentence.
2. On `idempotency_key_reused`, name the day the key already wrote and say it
   succeeded, so the caller knows the first write is safe and only needs a new
   key. Check what `recall` returns on a conflict and widen it if the stored
   value is not reachable — `lib/mcp/idempotency.ts`.
3. Name the media endpoint in the day-fields sentence, in both documents.
4. Give the empty-`files` refusal a `hint` naming the form field, matching how
   `expected_multipart` immediately above it already reads.

## Acceptance

- Both documents advise how to title repeated places, and name the media
  endpoint where they mention photographs.
- A reused idempotency key's refusal names the day it belongs to and says that
  write succeeded; a test asserts it.
- The empty-`files` refusal carries a sentence naming `files`; a test asserts
  it. No aliases are accepted.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
