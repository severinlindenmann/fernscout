---
id: B317
title: The scripts say what to ask and never what to offer next, so an agent stops after each step
type: ISSUE
priority: medium
complexity: low
area: agent docs
found: "2026-09-04T16:55:51Z"
started: "2026-09-04T17:02:45Z"
merged: "2026-09-04T17:10:16Z"
---

# B317 — The scripts say what to ask and never what to offer next, so an agent stops after each step

## Why

B307 gave each flow a question script, which fixed *what to ask*. Watching an
owner drive an agent through a whole trip afterwards, the gap that remains is
**what to offer once the answers are in**. Three specific things the owner had
to ask for unprompted:

- **Photographs and coordinates.** The media endpoint is named (B292) and the
  coordinates question exists (B267), but nothing tells an agent to *offer*
  after a day is written — so an owner who has a folder of pictures has to
  think of it themselves, and the format (multipart, field `files`, `day` as
  the slug) is a paragraph away in the guide.
- **Publishing.** Every day an agent writes is a draft, deliberately (the one
  rule). Nothing prompts the agent to say *these are drafts, shall I put them
  up?* — so days sit unpublished until the owner remembers, which is the whole
  point of the draft and also its whole cost.
- **A guest link.** An owner with a finished trip and a family to show it to
  has no reason to know `POST /api/v1/<user>/invites` exists. The invite
  machinery is documented; nothing suggests using it.

None of these is a missing capability. Each is a step the software supports and
the documents describe as *reference* rather than as *the next thing to
offer*. B307 established that a procedure has to read as a procedure; this is
the other half of the same finding.

## Work

Extend each flow's script with what follows it — the *next offer*, not a
second question list. Small, and it belongs beside the questions in
`lib/api/agentCopy.ts` so both documents get it from one place.

- **After a day is written**: offer photographs, naming the call and the field
  names in one line (`multipart/form-data`, `day: <slug>`, `files: <binary>`),
  and offer coordinates if the prose named a place and none were given.
- **After a trip's days are written**: say plainly that they are drafts, that
  nothing is on the site yet, and ask whether to publish — one call per day,
  and the owner's decision every time. The existing rule that an agent must
  ask in words and wait is unchanged and is the reason this is an *offer*, not
  a default.
- **After a trip is published**: offer a guest link, and say what it is —
  leads to reading the journal's `guest` trips, safe to forward, grants
  nothing until the owner approves whoever opens it. B319 may change how that
  link is delivered; write the offer so it survives that.

Do not turn this into a state machine. It is three sentences saying "having
done that, offer this" — an agent that knows the next useful step will take
it, and the transcripts show the failure is simply that nothing says what the
step is.

Watch the length: B308 is open because these documents have grown all day.
Prefer one clause appended to an existing question over a new section.

## Acceptance

- Both documents say, for each of the three flows, what to offer once the
  questions are answered.
- The photographs offer names the endpoint, the `day` field and the `files`
  field, so an agent need not fetch the guide to act on it.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
