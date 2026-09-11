---
id: B1053
title: The helper's tool list has outgrown the budget its own test set, and the fix is grouping
type: ISSUE
priority: high
complexity: medium
area: agent, helper
found: "2026-09-09T07:11:30Z"
started: "2026-09-11T12:08:54Z"
merged: "2026-09-11T12:26:39Z"
completed: "2026-09-11T13:18:29Z"
---

# B1053 — The helper's tool list has outgrown the budget its own test set, and the fix is grouping

## Why

See the "Why" and both "Decision" sections below — this is the ticket that
found the problem, argued it out over two decisions, and this section records
what was actually built once B1450 (the cache breakpoint) changed the ground
under it.

## Work

**Built: two-pass by area, with `trips` as a fixed hub area alongside
whichever one the pick round names.**

- `lib/helper/tools/registry.ts` — the seven area arrays are now one `AREAS`
  list (`{ key, describe, tools }`), each `describe` written for the model
  doing the picking, not for a person. `TOOLS` is `AREAS.flatMap(...)`, so
  every existing caller that wants the whole registry (the honesty tests,
  `runTool`'s lookup by name, the generated menu in the system prompt) is
  unchanged. `AreaKey` is the literal union of the seven keys.
- `lib/helper/tools/run.ts` — `toolSchemas()` takes an optional tool list and
  defaults to the whole registry, so it still serves callers that want
  everything (the ceiling test, `test/helper-tools.test.ts`).
- `lib/helper/model.ts` — before `rounds()` starts, one small, uncached call
  (`pickArea`, structured JSON output like `findInJournal`) asks which one
  area the conversation needs. `activeAreas` starts as `{trips, <picked>}` and
  is decided **once per turn, not per round** — `rounds()`'s loop reads it
  fresh each iteration but nothing in the ordinary path changes it mid-turn,
  which is what keeps B1450's tools+system cache prefix stable round to
  round. `trips` is always included because it is the one area nearly every
  other tool resolves a trip id off, and because the picked area alone can be
  small enough to push the whole prefix under Haiku's 4,096-token cache
  minimum — see the comment above `HUB_AREA` for the measured numbers.
- **Recovery**: every turn also carries one meta-tool, `switch_area` (not in
  the registry, intercepted directly in `rounds()`'s call loop before the
  ordinary `TOOLS.find` lookup). If the model decides the picked area was not
  enough, it calls `switch_area({ area })`, which adds that area's tools to
  `activeAreas` for the next round of the *same* turn — the one case allowed
  to cost the round-to-round cache, because the alternative is a capability
  the model cannot reach at all.
- `test/helper-tool-areas.test.ts` — new, asserts the registry partitions
  cleanly into the seven areas and that the worst case a turn can send
  (hub + the single largest other area + `switch_area`) is well under half
  the registry: 20 of 47 tools today.
- Six test files that scripted `@anthropic-ai/sdk` responses turn by turn
  (`helper-thread`, `helper-honesty`, `helper-honesty-per-turn`,
  `helper-honesty-postcard-page`, `helper-refusal-recovers`,
  `helper-trips-picker`, `whatsapp-model-turn`) needed one change each: their
  mocked `create` now answers the area-pick call structurally (by the
  `output_config` schema shape) before it reaches the scripted
  `mockResolvedValueOnce` queue, so the extra round trip does not shift every
  existing scripted round down by one. Which area it answers with does not
  matter to any of those tests — the scripted model always names the tool it
  wants outright, regardless of which schemas were technically on offer.

**Not done:** moving B1450's cache breakpoint, and no relevance filtering.
Both considered and rejected per the decisions below.

## Acceptance

- `npm run verify` passes — build, tsc, eslint, the full vitest suite (6,861
  tests) and knip all green in this worktree.
- `test/helper-tool-areas.test.ts` asserts the per-turn count materially
  smaller than the registry's total, not just its byte size: 20 tools in the
  worst ordinary case against 47 in the registry.
- `test/helper-tools.test.ts` and the honesty counters are unchanged and
  still pass — nothing lost reachability, because `runTool` still resolves
  against the whole `TOOLS` registry regardless of which schemas were on
  offer, and `switch_area` reaches any area that was not.

## Why

**Update, hours later: the ceiling was raised to 8,000 by B1049**, in a
parallel session, while this was being written. `main` is green again and
nothing is blocked — so read everything below as the standing argument for
grouping, not as a broken build. The numbers it cites are the ones that
prompted it.

`test/helper-thread.test.ts` measures the prompt plus the tool schemas and
asserts a ceiling. The list reached **~7,617 tokens against a ceiling of
6,500**, and `main` failed `npm run verify` until the raise.

Nothing did this wrong. Five tool-adding tickets merged inside about an hour —
B1024 (rates and budget), B1025 (invites, telling readers, channels), B1026
(settings, keys, credits, past conversations), B1027 (postcards and the
photobook), B1028 (the inbox, remove_photo, discard_file) — plus B906's
`find_day`. Each branch verified green against a `main` that did not yet carry
the others' tools, so every one of them was honest at the moment it was
measured, and the sum was nobody's to see. That is a fact about parallel
merges, not about any of those tickets.

**The ceiling should not be raised again, and the test says so itself**, in the
paragraph B1023 left above it when it raised the number to 6,500:

> So: raised once, deliberately, with room for the whole round rather than a
> raise per capability. **If this fails again, the answer is almost certainly
> not another raise** — it is that the list has grown past what a model can
> choose well from, and the fix is grouping, not budget. B930 is still open and
> this does not close it.

That prediction has now come true, one round later. The registry is ~48 tools.
The same paragraph already establishes that money is not the constraint — the
whole list costs a fraction of a rappen a turn — so this is not a cost ticket.
It is the choosing problem: a model picking among fifty tools picks worse than
one picking among seventeen, and the honesty counters are where that shows up.

## Work

Decide the grouping and then build it. The shape is a person's call, and the
options worth weighing are at least:

- **Two passes.** The model is offered a small set of *areas* — the directory
  `lib/helper/tools/areas/` already names them: days, trips, money, files,
  readers, journal — and only the chosen area's tools are expanded into
  schemas on the second turn. Costs a round trip; cuts the list a model
  chooses from to well under ten.
- **Relevance.** Offer the tools this conversation could plausibly need, from
  what the turn already knows — no trip in hand means no `set_budget`. Cheaper,
  but a wrong guess makes a capability invisible rather than merely unlikely,
  which is the failure mode B858 and B1038 are both about.
- **Merging tools that are one question.** Several pairs read as one thing to a
  person (`trip_costs`/`set_budget`/`set_rate`; `invites`/`revoke_invite`).
  Fewer, wider tools with an argument that says which way.

Whatever is chosen, keep the measurement: the test is the only thing that
noticed, and it noticed the same day.

Not doing: raising the ceiling again. B1049 already did it once — to 8,000,
in its own commit — which bought room for this round and is exactly the "raise
per capability" the 6,500 paragraph set out to stop. A third raise is not the
answer; the choosing problem is unaffected by the budget.

## Acceptance

- `npm run verify` passes on `main`.
- The number of tools a single model turn chooses among is materially smaller
  than the registry's total, and a test asserts that rather than the byte size
  alone.
- The honesty counters and `test/helper-tools.test.ts` still pass — grouping
  must not make a capability unreachable, which is the one way this fix is
  worse than the problem.

## Decision, 2026-09-11

**Group the registry.** Asked directly after B1393 landed, and answered: the
registry is grouped into areas a model picks from, not given a third raise.
The ceiling is the symptom and the choosing is the cost, which is what this
ticket said already.

B1393 is the evidence that settled it. Adding one tool (`add_contact`) took
the tool-schema budget to **7,979 of 8,000**, and it only fitted after
trimming description strings — 21 tokens of headroom for the next tool
anybody adds. See B1049 for the same argument from the model's side.

## Decision, 2026-09-11 (the shape)

**Two-pass by area.** The model first picks an area, then chooses among that
area's tools. Chosen over relevance filtering, which is cheaper — no extra round
trip — and is exactly the failure mode B858 and B1038 already recorded: a
capability the filter hides is a capability the model will swear does not exist.
The areas are real rather than invented, since B1042 already split the registry
into `lib/helper/tools/areas/`.

The cost, stated: one extra round trip per turn.

**Hold released the same day.** The sibling work was **B1450** — one
`cache_control` breakpoint on the system prompt in `rounds()`, plus cache tokens
folded into what `book()` records — and it merged to `main` at `a8465245`. So
this ticket builds on top of it rather than against it, and two things about
B1450 change how the grouping must be written:

- **Render order is tools → system → messages, and B1450's single cache marker
  sits on the system prompt to cover both halves.** A two-pass design that
  varies the tool list *per turn* invalidates that prefix on every turn, which
  would undo an 84% saving to fix a choosing problem. Whatever the grouping
  does, the cached prefix has to stay stable — most likely by keeping the area
  *selection* pass cheap and unparameterised, or by moving the breakpoint.
  Measure it; do not assume.
- **Haiku 4.5 will not cache a prefix under 4,096 tokens and says nothing when
  it declines.** The tool schemas are two thirds of B1450's measured ~10,800
  token prefix. A grouping that cuts the per-turn schema size hard could drop
  the prefix below 4,096 and silently turn caching off — the saving would vanish
  with no error anywhere. B1450's acceptance line exists for exactly this.

That is not an argument against grouping. It is the constraint the grouping has
to be designed inside, and it was invisible until B1450 measured it.

Verified before deciding: B1042's split is source-file only.
`toolSchemas()` (`lib/helper/tools/run.ts:23-34`) still flattens the whole
`TOOLS` array and sends every tool on every turn, and
`test/helper-thread.test.ts:752` still asserts a flat `CEILING = 8000` against
the whole prompt rather than a per-turn subset.
