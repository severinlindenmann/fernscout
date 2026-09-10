---
id: B1043
title: The helper has no tool for captioning a photograph or telling readers a day is up
type: FEATURE
priority: low
complexity: low
area: agent
found: "2026-09-09T04:59:16Z"
---

# B1043 — The helper has no tool for captioning a photograph or telling readers a day is up

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Split out of B891 when that ticket was closed as superseded on 2026-09-09.
B891's tool list named ten write tools. Nine of them shipped under B900 and the
chain after it. Two did not appear in `lib/helper/tools.ts` under those names,
and nobody has checked whether they were renamed, folded into another tool, or
simply never built:

- `caption_photos` — writing a caption onto a photograph already attached to a
  day. `add_photos` and `attach_files` put pictures on a day; neither is a way
  to say what one is of.
- `notify_readers` — telling the people who may read a journal that a day is
  up. Push exists as a capability (see B1025) and `scripts/notify.mts` sends,
  but the helper has no tool that reaches it.

Neither is urgent. Both are the kind of gap that only shows up when somebody
asks for them in the room and the model answers in prose instead.

## Work

First establish which of the two is genuinely missing rather than renamed —
read the whole `TOOLS` array in `lib/helper/tools.ts` before adding anything.

For whichever is real:

- A caption tool would be a write tool like every other: it returns a proposal
  naming the photograph and the words, and writes nothing until the person
  presses. The honesty net in `lib/helper/model.ts` may need a check for the
  new kind of claim it makes possible — AGENTS.md says adding a tool may mean
  adding a check, and a caption is a claim about what a picture shows.
- A notify tool must not become a way to send to people the owner has not let
  in. It reaches the same path `scripts/notify.mts` uses and no other.

Not doing: anything that writes a caption from the model's own reading of the
photograph. What is in a picture is a thing that happened, and AGENTS.md's rule
about inventing a day applies to inventing what a photograph shows.

## Acceptance

- Whichever tool is added returns a proposal and writes nothing until accepted.
- `npm run verify` passes, including the helper tool tests.
- A test asserts the tool cannot reach an address the journal has not admitted.
