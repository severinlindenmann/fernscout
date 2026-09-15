# Review — B1806 + B1807

## Verdict A — Spec compliance: MOSTLY COMPLIANT, one accuracy gap
## Verdict B — Code quality: ONE REAL BUG, verify gate currently RED

## Verify result

`VERIFY_WILL_WAIT=1 npm run verify` — **FAILED**, at the `unused` (`npm run unused` / knip) step.
Build, TypeScript, ESLint and Vitest (640 files, 8013 passed / 4 skipped) all
passed. Knip failed with:

```
Unused files (1)
.superpowers/sdd/b1806/check-ticker.mjs
```

This file is new in this diff and is not covered by any `knip.jsonc` entry
pattern (`.claude/skills/**/*.mjs` is listed; `.superpowers/sdd/**` is not).
The gate is red as a direct, mechanical consequence of this diff.

## Findings, most severe first

1. **Verify gate fails — `knip.jsonc:knip.jsonc` has no entry for
   `.superpowers/sdd/b1806/check-ticker.mjs`.** `npm run unused` reports it as
   dead code and stops the pipeline (`npm run verify` never reaches its final
   green state). Either add an entry pattern for this script (matching how
   `.claude/skills/**/*.mjs` is already handled) or move/remove it before
   merge.

2. **`app/api/helper/[user]/extract/upload/route.ts:100`** — the
   journal-capacity check runs on `file.size` *before* the file is written
   and before duplicate detection (`stored.id` is only known after
   `putStagedFile` at line 105, and the dedup skip is at line 112). A retry of
   a batch where some files already landed on disk (same content, same
   content-addressed id) can be wrongly rejected with
   `journal_over_capacity` when the journal is near the ceiling, even though
   re-sending that file costs zero new bytes (`putStagedFile`'s own
   `existsSync` guard is a no-op write). This breaks the idempotent-retry
   guarantee the surrounding comments describe ("a retried batch is
   idempotent... the running total is not charged for it twice") specifically
   in the one case — near the ceiling — where it matters most. No test in
   `test/extract-upload-ceiling.test.ts` covers a duplicate/retry near the
   ceiling; all four cases there use fresh, never-before-seen filenames.

3. **`components/extract/ResumeScreen.tsx:286-290`** — the storage-bar
   copy `extract.resume.storage.bar` ("{used} of {limit} staged across
   {count} imports") uses `runs.length` for `{count}`, but `runs` is the
   list already filtered by `GET .../extract/runs` to
   `unusedPhotoCount(run) > 0` (see that route's own doc comment). The byte
   total shown (`storage.usedBytes`, from `journalStagingBytes`) sums *every*
   run the journal owns, including spent/committed runs whose files still sit
   on disk until the sweep removes them (the route's own comment says so
   explicitly: "a spent, empty run still holds real bytes... B1807's ceiling
   counts every one of them"). A journal with, say, 3 resumable runs plus 2
   already-spent-but-not-yet-swept runs would show "5.6 GB … staged across 3
   imports" while the real count contributing those bytes is 5 — an invented,
   inaccurate number next to a real one, in a sentence whose whole point is
   to be actionable ("an old, forgotten import may be using it").

4. **Ticket-text vs. draft conflict, resolved but worth naming explicitly.**
   B1806's own Acceptance criteria say "seconds only below an hour," but the
   approved draft (`ticker.html`) shows a live seconds box in the two-days-out
   "calm" example, and `segmentsFor` (`lib/staging/countdown.ts:125-131`)
   matches the draft, not the acceptance line. `progress.md` documents this
   as a deliberate ruling in the draft's favor (which the ticket itself says
   to trust over its own prose). Not a defect, but the acceptance text is now
   false and nobody has gone back to fix it.

5. **`lib/validate/media.ts` / `UploadStep.tsx:281` — storage bar has no
   urgency ladder.** B1807's task file asks for the bar to be "in the same
   visual language as B1806's countdown bar," but the storage bar is a fixed
   `bg-yellow-400` regardless of how close to 100% the journal is (never
   escalates toward the coral/urgent treatment the ticket's own bar does).
   Minor — the acceptance criteria don't literally require a ladder, but it's
   a visible asymmetry between the two "same language" bars on the same
   screen.

6. **Browser verification for B1807 didn't reach "near the ceiling."** The
   captured shots (`resume-*-v2-*.json`) show `5.6 GB of 10.0 GB` — just over
   the 50% warn line, not near the 10 GB ceiling the acceptance text asks for
   ("Verified at 390px in both themes with a run that is near the ceiling").
   The automated tests do exercise near-ceiling behavior with a mocked 1000-
   byte limit, so functional coverage exists; only the literal browser
   verification is short of the stated bar.

## What checks out

- `font-variant-numeric: tabular-nums` present (`tabular-nums` Tailwind
  utility) on the digit boxes.
- Segment count/shape (4 → 3 → 2) and the urgency ladder (`calm`/`soon`/
  `urgent`/`gone`) are derived from `countdownFor`'s existing tiers, not a
  second set of thresholds — matches the ticket's "extend, don't duplicate"
  instruction.
- `DIGIT_CLASS`/`LABEL_CLASS` use only tokens vetted by
  `test/contrast.test.ts` as safe text colours (`ink-strong`, `coral-600`);
  `yellow-*`/`coral-300`/`coral-400` are used fill-only (background/border),
  matching the ban on those as `text-` classes. Documented and deliberate.
- Pulse is last-minute, seconds-box-only, and removed (not just paused) under
  `prefers-reduced-motion` via `.fs-ticker-pulse` in `app/globals.css`.
- Past-zero (`gone`) renders `00:00:00`, dashed border, no seconds pulse,
  zero-width bar — never negative.
- `windowFractionFor` correctly re-pins to the current window
  (`extendedAt` ?? `warnedAt` ?? `createdAt`) so an extension refills the bar
  rather than reading a stale fraction of the original 48h; covered by
  `test/staging-countdown.test.ts`.
- B1807's ceiling is genuinely per-journal: `journalStagingBytes` sums
  `runBytes` over every run `listRuns(user)` returns (not just the current
  run), and staging still lives under `stagingRoot()`
  (`lib/staging/paths.ts`), outside `userDir()`/`journalBytes`, so it does not
  double-count against the storage quota — confirmed by reading
  `lib/staging/paths.ts`'s own doc comment and by
  `test/extract-upload-ceiling.test.ts`'s "a different journal's staged bytes
  never count against this one" / "bytes already staged in a different run of
  the same journal count against the ceiling" cases.
- "Accept what fits" is implemented (per-file rejection with
  `journal_over_capacity`, not whole-batch failure) and both the choosing
  screen's limits table and the upload/resume bars show the real server
  figure (`stagedBytes`/`stagedLimitBytes`), not a browser-side estimate —
  satisfies AGENTS.md's "limits discoverable before a caller hits them."
- New keys (`extract.resume.storage.bar[.one]`, `extract.resume.ticker.*`,
  `extract.upload.limits.storage`, `extract.upload.limits.storageValue`,
  `extract.upload.storageBar`, `extract.upload.rejected.{tooLarge,runFull,
  overCapacity,other}`) all have real en/de/hu entries in
  `site/locales/{en,de,hu}.json`, and every counted string
  (`daysLeft`, `storage.bar`) has a `.one` variant used through `tn()`.
- No `window.confirm`/`alert`/`prompt`; destroy still goes through
  `ConfirmPanel`.
- No obvious 390px overflow: the ticker row's segments are fixed-width
  (`min-w-10`) with small gaps, well under a 390px card; no `truncate` used
  anywhere in the new markup, so the `truncate`+`min-w-0` binding constraint
  doesn't apply here.
