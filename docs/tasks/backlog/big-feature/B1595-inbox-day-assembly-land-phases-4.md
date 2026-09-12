---
id: B1595
title: Inbox day-assembly: land Phases 4-5 (statement store, GPS extraction)
type: FEATURE
priority: medium
complexity: high
area: helper, inbox, whatsapp, day-assembly
found: "2026-09-12T16:49:27Z"
---

# B1595 — Inbox day-assembly: land Phases 4-5 (statement store, GPS extraction)

## Why

`docs/superpowers/specs/2026-09-12-inbox-day-assembly-design.md` describes
five phases. Phases 1-3 are built and merged into `main` (via
`subagent-driven-development`, each with its own final whole-branch review —
Phase 1 caught two real security issues, Phase 3 caught four load-bearing
gaps in the ask/answer/create loop, both fixed and re-verified before merge).
Phases 4-5 remain: a persistent bank-statement store
(`docs/superpowers/plans/2026-09-12-inbox-day-assembly-phase-4.md`) and GPS
as an extractable location source
(`docs/superpowers/plans/2026-09-12-inbox-day-assembly-phase-5.md`). Both
plans are already written and were self-reviewed as solid before Phase 4
started (see the earlier phases' plans for the same treatment).

## Current state (as of 2026-09-12, session paused here)

- Phases 1, 2, 3 are merged into `main` (latest: commit `0023053c`, "Merge
  inbox day-assembly Phase 3: the conversation").
- **`npm run verify` on the merged `main` after Phase 3's merge was NOT yet
  run to completion** — the previous session was interrupted mid-run. Run it
  before doing anything else, from the main checkout:
  `npm run verify`. If it fails, that is the first thing to fix — it is
  extremely unlikely given every prior stage passed on the branch before
  merging, but confirm rather than assume.
- The Phase 3 worktree/branch (`.claude/worktrees/inbox-day-assembly-phase3`,
  branch `inbox-day-assembly-phase3`) is **still present** — deliberately not
  cleaned up yet, since the post-merge verify hadn't been confirmed. Once
  `npm run verify` passes on `main`, remove it the ordinary way:
  `git worktree remove .claude/worktrees/inbox-day-assembly-phase3 &&
  git worktree prune && git branch -d inbox-day-assembly-phase3`.
- No SDD workspace remains for Phases 1-3 (each was `rm -rf`'d after its
  final review passed, per the `subagent-driven-development` skill's own
  finish step) — the git history (commit messages, PR-style merge commits)
  is the record of what each phase's ledger held, including every ruling
  made along the way.

## Work

Build Phase 4 and Phase 5 the same way Phases 1-3 were built: fresh worktree
from `main` per phase, `subagent-driven-development` (fresh implementer
subagent per task, task-scoped review, fix loop as needed, final
whole-branch review including a full `npm run verify`, merge only after
that's clean). Phase 4 depends on nothing new; Phase 5 depends only on
Phase 2 (already merged), so either order works, but the plans' own stated
build order is 4 then 5.

Expect the final whole-branch review to find something — it has on all
three phases built so far (Phase 1: a vCard-injection guest-invite hijack
and a pre-approved-email privilege escalation; Phase 2: dated inbox rows
with controls no action path could back; Phase 3: four gaps in the
ask/answer/create loop). Budget time for at least one fix round per phase
rather than assuming a clean pass.

Phase 5 in particular touches `gps/` — AGENTS.md's own words: "the most
sensitive folder in this repository... reachable from nothing under `app/`".
`test/gps-store.test.ts`'s import-graph assertion is the check that would
catch a violation; treat any failure there as maximally serious, never as a
test to weaken.

## Acceptance

- Phase 4's plan fully executed: a persistent statement store mirroring
  `gps/`'s own shape, wired into the existing costs-import flow and into
  `assemble_day`'s missing-fields check, merged into `main` with `npm run
  verify` green.
- Phase 5's plan fully executed: `lib/gps/api.ts` gains a presence check and
  an extraction, offered as a proposal from `assemble_day`, with
  `test/gps-store.test.ts`'s import-graph guard still passing, merged into
  `main` with `npm run verify` green.
- Both phases' SDD workspaces removed after their final reviews pass, same
  as Phases 1-3.
