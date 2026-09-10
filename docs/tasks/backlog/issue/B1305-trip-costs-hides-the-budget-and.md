---
id: B1305
title: trip_costs hides the budget and publish_day offers a double publish
type: ISSUE
priority: high
complexity: low
area: whatsapp, helper, honesty
found: "2026-09-10T11:51:14Z"
---

# B1305 — trip_costs hides the budget and publish_day offers a double publish

## Why

scenario-costs.md defect C: "wie steht es ums budget?" answered *"Ich sehe
kein Budget für Switzerland"* for a trip whose `costs.md` genuinely carried
one (`budget: {total: 1500, days: 12, currency: CHF}`). `lib/costs.ts`'s
`getCostSummary()` has always computed a full `budget: BudgetStatus` —
total, days, perDay, remaining, and, once the trip has begun, a `pace`
block — and returns it on `CostSummary.budget`. `lib/helper/tools/areas/
money.ts:48-91`'s `trip_costs` tool, the only budget-shaped read tool that
exists anywhere in `lib/helper/tools/`, built its returned object from six
other fields on `CostSummary` and never read `.budget` at all. The model was
truthfully reporting what its tool handed it; the tool silently dropped a
field that was computed, present, and shown on the web cost page.

scenario-edges.md finding 3: "veröffentliche den tag von gestern", asked
about an already-published day, drew a full confirm card — "read this the
way your readers will; a press puts it on the page" — for a day already on
the page. The route-level 409 (`already_published`) kept the actual write
safe, but the person got a pointless card and a wasted press.
`lib/helper/tools/areas/days.ts:331-398`'s `publish_day.propose` had no
refuse check for this case, while its mirror `unpublish_day` (~line 429-436)
does refuse the mirror case (a draft that was never up) — and its own
comment claimed *"`publish_day` has always refused a day that is already
published"*, which reading the actual code showed was false. There was no
`agent.tool.alreadyPublished` key anywhere in `site/locales/*.json`, which
is what confirmed the symmetric guard had never actually been built.

## Work

- `lib/helper/tools/areas/money.ts`: `trip_costs` now returns `budget:
  costs.budget` (absent/`undefined` when no budget is set — nothing here
  invents one). `describe` documents the shape so the model knows to say
  "absent" honestly rather than guess.
- `lib/helper/tools/areas/days.ts`: `publish_day.propose` gained
  `...(found && !found.entry.draft ? { refuse: "agent.tool.alreadyPublished" } : {})`,
  mirroring `unpublish_day`'s own `agent.tool.alreadyDraft` check exactly.
  New locale key `agent.tool.alreadyPublished`, en/de/hu. The stale comment
  on `unpublish_day` claiming a symmetry that did not exist is corrected —
  each tool's own `refuse` line is now beside its own `propose`, true on its
  own, rather than one function's comment asserting a fact about the other.

## Acceptance

- `test/helper-money.test.ts` ("trip_costs — B1305, scenario-costs.md defect
  C"): `budget` is absent before `set_budget`, present and correct after.
- `test/helper-publish-press.test.ts` ("publishing a day that is already up
  — B1305"): an already-published day refuses `publish_day` with
  `agent.tool.alreadyPublished` and no proposal; a draft still proposes
  normally.
