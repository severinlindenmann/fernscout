# SDD ledger — plan: docs/superpowers/plans/2026-09-15-the-import-you-can-see.md

Ticket B1803. Branch `b1803-the-spine`.
Worktree: /Users/severin/Documents/GitHub/fernscout/.claude/worktrees/b1803-the-spine
Spec: `.superpowers/sdd/b1803/design-v2.html` — **reachable this time.** The
previous plan named the same file as its spec, described it in prose on a false
assumption that a subagent could not read it, and that single unchecked
assumption is the root cause of every ticket from B1797 onward. Every brief in
this run carries the per-screen specification inline AND the path to the file.

## Pre-flight scan

| # | Tasks | Shared | Finding |
| --- | --- | --- | --- |
| 1 | 1.1 ↔ 1.2 | the thumbnail URL | 1.2's tile consumes the route 1.1 builds. Serial, not parallel. |
| 2 | 1.2 ↔ 1.3 | tile/strip/viewer | 1.3 imports all three. Serial. |
| 3 | 1.3 ↔ 2.x ↔ 3.x | six component files | Heavy overlap — every later phase edits the same six components 1.3 touches. **Serial throughout.** R8's overlap rule does not help here; there is no disjoint pair after Phase 1. |
| 4 | 1.1 ↔ `readStagedFile` | lib/staging/store.ts | Read-only consumer. Clean. |
| 5 | 1.3 ↔ object URLs | UploadStep | Local previews before upload need `URL.createObjectURL` + revoke. 500 unreleased is a real leak on a phone. Called out in the brief. |
| 6 | 3.4 ↔ Deepgram | per-word confidence | The plan asserts Deepgram returns it. **Unverified by me** — if it does not, the uncertain-word highlight has no data source and the screen needs a different mechanism. Carried into 3.4's dispatch as a thing to check first and report. |
| 7 | 4.1 ↔ lib/helper/speech.ts | SPEECH_LANGUAGES | Verified: `["en","de","de-CH","hu"]` exists and the route takes an override. Small task. |
| 8 | Global | no-publish test | Recursive over components/extract and lib/extract since B1802. New components land inside it; do not defeat it. |

Ruling R34: **serial execution throughout.** Finding 3 means there is no safe
overlap after Phase 1 — every phase edits the same six components. One
implementer at a time, one reviewer alongside. Slower and the only correct
option; two writers in this worktree would collide on every task.

Ruling R35: Phase 1 ships before anything in Phases 2–4 starts. Not a
preference — Phases 2 and 3 decorate screens that are not worth looking at until
photographs are on them, and reviewing chrome on a screen with no content is
reviewing the wrong thing.

## Progress

Task 1.1: dispatched (sonnet), base 3e3fa490.
