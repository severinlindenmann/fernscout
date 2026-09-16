# Task 2 report — the step indicator, selection, icons, the primary button

Status: **DONE**

Commits: `dbfa952e` (Task 2.1 — the indicator itself, wired into FoundStep and
UploadStep, plus UploadStep's camera-icon primary button) and `8d1d9b15`
(TripModeStep's own indicator + pin/mic/lines icons, DayBoard's "days told"
indicator + the selected-day yellow ring, AskCard's per-question indicator).
Base was `ebc6be54`.

## What actually changed

New `components/extract/StepIndicator.tsx` — a segmented bar plus a
caller-supplied label, never a percentage. It takes `total`/`current` (which
decide the segments drawn and the one picked out in yellow) and a `label`
string the caller has already resolved with `t()`/`tn()`, because the two
numbers behind the label are not always the two numbers behind the segments
— the day board's segments are "days told out of days in the trip" and its
label matches, but the per-question screens (S7a/S7c) draw segments for "which
open question is this" while the label reads "day 4 of 9", a different real
count. Both are always read off the run (`groups`, `manifest`, `open.length`)
— nothing here is a hardcoded 9 or a hardcoded 4. The wizard's own five-screen
shape (`1 of 5` … `4 of 5`) is the one place a literal `5` is used, since that
is the flow's own fixed structure, not something any run could answer
differently.

Wired: TripModeStep (`1 of 5`, `2 of 5`), UploadStep (`3 of 5`, covering both
the picker and the mid-upload screen), FoundStep (`4 of 5`), DayBoard
(`{daysTold} of {daysTotal} days told`), AskCard (`day {dayIndex} of
{dayTotal}`, segments = the day's currently-open questions).

Selection ring: TripModeStep's cards already carried
`ring-2 ring-yellow-300 border-yellow-600` from B1797 — nothing to add there.
DayBoard's day list did not have an equivalent for "which day is open", so its
selected `<li>` now gets the same ring treatment, matching design-v2.html's
`.card.sel`.

Icons: `lucide-react` (already a repository dependency, used throughout
`components/`) supplied `MapPin` (trip cards, S2a — the design's own "pin" is
literally about where the trip goes), `Mic`/`AlignLeft` (talk/type cards,
S2b), `Camera` (UploadStep's primary button, S3a). No new dependency.

Button labels: `extract.tripMode.nextMode`, `.nextPhotos`,
`extract.upload.choose`, and `extract.found.seeDays` already held the design's
exact copy ("Next: how you'll tell it", "Next: choose photographs", "Choose
from your library", "See my N days") from earlier work on this branch — the
only change needed was styling UploadStep's `<label>` as the design's primary
yellow button rather than the plain outline it had.

## Locale keys added (en/de/hu, `npm run i18n:keys` run)

`extract.step.ofTotal`, `extract.step.dayOfTotal` (plain — neither has a noun
that pluralizes; "1 of 5" and "day 4 of 9" are ordinal positions, not counts
of things), and `extract.step.daysTold` / `.daysTold.one` (a real `tn()` pair,
keyed on the day count since "day/days" describes the trip's own total).

## Verification

- `npm run verify` (foreground, exit 0): 640 test files, 8015 tests passed, 4
  skipped; build, typecheck, lint, vitest and knip all green.
- `npm run check:changed` on the touched files passed while iterating.
- Real browser, local checkout, journal `example` (auth/helper/credits/mail
  turned on in `site/config.json`, `extract` turned on there and in
  `content/example/config.json` — both reverted after testing;
  `.local-dev.db` copied in and removed afterward).

### What I could reach and looked at

Screenshots and JSON in `.superpowers/sdd/b1803/shots-phase2/` (the static
`check-page.mjs` pass — 0 console errors, 0 failed requests, status 200 on
every capture, both real light and real dark via a patched copy of the script
that explicitly emulates `prefers-color-scheme` — headless Chrome's own
default turned out to be dark, so an unpatched "light" capture was silently
still dark; caught by comparing screenshots, not assumed):

- `extract-hub-{light,dark}-{1280,390}` — `/example/extract`
- `extract-photos-{light,dark}-{1280,390}` — `/example/extract/photos`, which
  landed on `ResumeScreen` because journal `example` already had a live
  staged run (pre-existing local test data, not part of this branch)

Since the capture script cannot click, I also drove an ad-hoc interactive CDP
script (a throwaway file in the scratchpad, not committed) that sets the same
cookies, clicks by matched button text, and screenshots — real interaction,
real data, not a fixture authored for this change:

- **DayBoard** (`0 of 2 days told`, both real numbers) — 390 and 1280, light
  and dark. Opening a day shows the yellow ring around it.
- **AskCard** inside that opened day — `day 1 of 2` label, segments moving
  from `1/2` to `2/2` across the day's two open questions — 390, light and
  dark.
- **TripModeStep S2a** ("A new trip, or one you already have?") — pin icons on
  both cards, yellow ring on the selected one, `1 of 5` — 390 and 1280, light
  and dark.
- **UploadStep** — `3 of 5`, the camera-icon primary button, the limits table
  with real numbers from `lib/validate/media.ts` — 390, light and dark.

Zero console errors and zero failed requests across every capture in both
passes.

### What I could NOT reach, and why

**TripModeStep S2b** (the talk/type screen with the `Mic`/`AlignLeft` icons)
never rendered in this pass: it only shows when `consentedSpeech` is true,
which needs a recorded per-journal consent file
(`content/<user>/helper-consent.json`) that `example` does not have and that I
did not fabricate rather than spend more time wiring up. The code path is
the same `OptionCard` component already screenshotted for S2a with the icon
prop wired the same way, so I am confident in it from the diff, but I have not
seen it rendered.

**FoundStep** (`4 of 5`) was not reached either — getting there needs a
completed upload with real files run through the browser's file input, which
this pass did not attempt (the existing staged run in `example` was already
past that point, in `state: "uploading"`, and a fresh run stopped at
`UploadStep` without me attaching files). Confirmed by source reading instead:
the indicator call is identical in shape to the three I did see rendered
(`FoundStep.tsx`, `current={4}`, `total={TOTAL_STEPS}`).

Both gaps are named here rather than implied as covered.

## Fix round 1 (commit `1499743b`)

Four task-review findings addressed:

1. **Undated-group double-count.** `DayBoard`'s `daysTotal` was `groups.length`
   (includes the synthetic undated group); `FoundStep`'s day count already
   excluded it. Shared fix: `lib/extract/dayCount.ts`'s `countDays`, called by
   both. Its own file rather than a new export on `lib/extract/group.ts` —
   that module's `clusterMedia` import reaches `lib/ingest/geo.ts`'s
   `node:fs`, and a real (not type-only) import of anything from it broke the
   client build (Turbopack: "the chunking context does not support external
   modules (request: node:fs)"). Caught by the full `npm run verify`, not
   assumed — first attempt put `countDays` in `group.ts` itself and the build
   failed.
2. **Wrong plural key.** `extract.step.daysTold`'s `tn()` was keyed on
   `daysTold` instead of `daysTotal` (the number "day/days" actually
   describes) — now fixed.
3. **Pin icons removed** from TripModeStep's S2a cards — design-v2.html draws
   none there; only S2b's talk/type cards carry an icon.
4. Two new tests, each confirmed RED against the pre-fix code (`git stash`,
   run, paste, restore) before being confirmed GREEN with the fix:
   `test/extract-day-count.test.ts`, `test/extract-day-board-progress.test.tsx`.

`npm run verify` green afterward: 642 test files, 8020 tests passed, all 5
gates clean.
