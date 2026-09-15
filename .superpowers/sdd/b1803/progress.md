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
Task 1.1: implemented (commit 832ac3ad), verify green (7951), 5/5 tests with RED
confirmed by removing the route file first.
Finding against my plan, accepted: I wrote that `readStagedFile` was the lookup.
It is not sufficient — `resizedCopy` needs a path to stat and cache-key, not a
Buffer. The implementer factored `stagedFilePath` out of `readStagedFile` and
added `stagedFileLocation` beside it, so both share ONE copy of the guard
(`runDir`'s segment validation plus `path.basename`) rather than duplicating it.
That is the right shape and the plan was wrong.
Task 1.1: task review dispatched (sonnet), base 3e3fa490 head 832ac3ad.
Task 1.2: dispatched (sonnet) — overlapped with 1.1's reviewer, which is
read-only and writes nothing. R34's serial rule is about two IMPLEMENTERS; 1.2
creates three new component files and touches none of 1.1's.
Task 1.1: review Approved — no Critical, no Important. Every guard traced by hand
rather than accepted: `../../../etc/passwd` collapses to `passwd` under this
run's own directory and 404s; a run id containing a slash makes `segment()` throw
and the route folds that into the same 404 rather than a 500; `resizedCopy`
returns null for a non-resizable extension so a .mov 404s with no poster frame
invented. The `stagedFilePath` extraction was verified by diff as a genuine
single source of truth — no second copy of the traversal guard exists anywhere.
The reviewer also caught something I had not looked for: the implementer had to
avoid a regression where moving `runDir` inside `readStagedFile`'s try would have
silently swallowed `segment()`'s throw. It computes the path outside the try, so
a malformed run id still throws rather than reading as "file not found".
Task 1.1: minor (deferred): no test drives the capability-off early return
through THIS route with isHelperOwner mocked true, so the documented order
(capability, then owner) is asserted in prose rather than proven. Cheap; fold
into a later task that touches this file.
Task 1.1: minor (deferred): `stagedFileLocation`'s comment could say it shares
the guard with `readStagedFile` via `stagedFilePath`, so a later reader does not
fix one and miss the other.
Task 1.1: complete (commits 3e3fa490..832ac3ad, review clean)
Task 1.2: implemented (commit 0ab1e86e), verify green (7966), 12 new tests.
Both named traps handled, and the video one better than I specified: a video is
decided by `kind` and never asks the route at all, rather than requesting and
catching the 404 — one fewer wasted request per video, and the owner's own test
folder was half .mov. Object URL created in a useMemo and revoked in a cleanup.
Ruling R36 (the implementer's own flagged ambiguity, and it is mine): the design
uses the word "avatar" for TWO different things — a 58px square photograph beside
a name on the who-came screen, and a circular person-icon `.avatar` class used as
a placeholder before a photograph is chosen. My spec table said "avatar | who
came | one small square beside a name", which describes the first. The
implementer built the first and flagged the second. That is correct: they are
different elements and the second is a placeholder, not a photograph shape.
Carried into Task 3.6's brief so the who-came screen draws both.
Task 1.2: task review dispatched (sonnet), base 832ac3ad head 0ab1e86e.
Task 1.3: dispatched (sonnet) — overlapped with a read-only reviewer only.
Task 1.2: review Approved — no Critical, no Important. All four named risks held
under direct inspection rather than assertion:
  - the object URL is revoked from a cleanup keyed on the derived url, so it
    fires on unmount AND before the next one is created; the test observes the
    OLD url being revoked rather than counting calls on a mock.
  - the video path is provably inert: `kind === "video"` short-circuits before
    `src` is touched, so a .mov never requests the route and there is no image
    element to retry; `onError` only flips a boolean and never mutates `src`.
  - one tile, four sizes, matched line-for-line against the design's own CSS.
  - every colour is a B1798-calibrated dark-aware pair, reused from DayBoard
    rather than newly invented. No repeat of either token bug.
It also found something better than the brief asked for: **the repository already
had a `Lightbox` primitive** and the viewer is built on it, inheriting close,
chevrons, swipe, focus trap and the counter. The brief said "check whether one
exists"; it checked, found one, and used it. That is the instruction working.
Both self-flagged deviations ruled sound, with the design's own CSS as evidence:
the hero's fixed heights in the mock are gradient placeholders, not photographs,
so a proportional box is right for content whose shape nobody controls.
Task 1.2: minor (deferred): `alt=""` on the inner img with the real label on the
wrapper reads like a missing-alt bug at a glance; one comment would settle it.
Task 1.2: complete (commits 832ac3ad..0ab1e86e, review clean)
Task 1.3: implemented (commits 5e6de959, 7b70f353), verify green (7974), six
screens wired.

Ruling R37 (the omitted badges — the implementer is right and my design was
wrong): it declined to draw the `62%` and `iCloud` badges because no data exists
to draw them honestly, and flagged it rather than faking them. Both are real
platform limits, not laziness:
  - `62%` needs per-file upload progress. `fetch` does not report upload
    progress at all; it needs XHR or a chunked upload with its own events. The
    app uploads a whole batch per request, so there is no per-file number to
    show even in principle today.
  - `iCloud` is not knowable. The File API gives no signal that a file is
    non-resident; the only symptom is a slow read, and inferring from timing is
    a heuristic dressed as a fact.
**I drew both into the design without checking either could be known.** That is
the same class of error as the rest of this saga, one layer up: I specified an
experience without checking the platform could supply it. Drawing them anyway
would have been inventing a state, which is the one thing this feature refuses.
Decision: they stay out. If per-file progress is wanted later it needs the
chunked upload B1751's own plan already names as a want, and that is a ticket,
not a badge. The iCloud one should never come back as a fact; at most a
timing-based "still fetching" hint, labelled as a guess.
Task 1.3: DayBoard keeps its accordion rather than the design's flat cards —
photographs wired in, layout not rebuilt. Carried to Phase 3.2, which owns that
screen's chrome.
Task 1.3: task review dispatched (sonnet), base 0ab1e86e head 7b70f353.
Controller is running the browser pass itself — the implementer flagged that it
did source+jsdom only, which is honest and leaves the visual check owed.
Task 1.3: review Approved with 1 Important; fix round 1/5 (1 addressed, 0 open;
commits 7b70f353..6286d280). The re-review traced the interaction rather than
reading the commit: a tap now only sets state and fires no network call; the
spend is reachable ONLY from a "Use this one" button inside the opened viewer;
the id is indexed from the same array the viewer's items were built from, so no
off-by-one; and the one-shot guard wraps the whole grid, so a run that has
already sampled cannot even open the viewer. The regression test observes the
absence of a real fetch to /extract/sample rather than a state flag.
`PhotoViewer`'s new `extra` prop is optional and its five other callers are
unaffected.
Also upheld under scrutiny: the badge omission. The reviewer established that
uploads go out in BATCHES OF TEN over `fetch`, so a per-tile percentage would be
reporting the batch's progress whatever API were used — fabricated by
construction, not merely unavailable. That is a stronger argument than the one I
made in R37 and it settles the question.
Task 1.3: minor (deferred): the `sr-only` list in UploadStep duplicating tile
state may cause redundant screen-reader announcement beside each tile's own label.
Task 1.3: minor (deferred): AskCard's outer wrapper is left unstyled.
Task 1.3: complete (commits 0ab1e86e..6286d280, review clean after 1 fix round)

PHASE 1 COMPLETE — 3 tasks, 5 commits, 1 fix round. The spine is in: a route
that serves a staged photograph, a tile/strip/viewer built on the repository's
own Lightbox, and photographs on all six screens that discuss them.
Owed and recorded: a real browser pass over the deeper screens, blocked on the
capture script being unable to click (filed as its own chore). Phase 3 rebuilds
those screens and will need the same pass, so it lands there.
