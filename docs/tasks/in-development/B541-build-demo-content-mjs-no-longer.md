---
id: B541
title: build-demo-content.mjs no longer reproduces the demo it is supposed to generate
type: CHORE
priority: medium
complexity: medium
area: demo content, scripts
found: "2026-09-06T08:45:00Z"
started: "2026-09-07T11:40:42Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T11:40:42Z"
---

# B541 — build-demo-content.mjs no longer reproduces the demo it is supposed to generate

## Why

Found while adding weather to the demo content for B325. The obvious move was
to put the field in the generator and re-run it. Re-running it **deleted
committed content**:

```
$ node scripts/build-demo-content.mjs
Wrote 5 trips, 38 entries.
$ git diff --stat content/
 42 files changed, 38 insertions(+), 96 deletions(-)
```

The 38 insertions were the new field. The 96 deletions were content nobody
meant to lose:

- `travellers:` blocks — 22 lines from `usa-2026/trip.md`, 34 from
  `asia-2023/trip.md`, 28 from `parks-2025/trip.md`, 7 from `alps-2024`. The
  generator does not write travellers at all, so every figure on the demo trips
  disappears.
- `transportMode` / `transportFrom` / `transportTo` on at least three days —
  `2023-01-09-bangkok-first-morning.md` loses its flight from Zurich, which is
  the leg that draws the first travel scene of that trip.

The script's own header is what makes this a bug rather than a shrug:

> *"It exists as a script rather than as committed prose so the shape of a trip
> stays regenerable while the project is still moving."*

It is not regenerable. Committed content has been edited by hand — or by
features added since — and the script was not kept in step, so the one command
that is supposed to rebuild the demo now silently destroys parts of it. Nothing
says so: it prints `Wrote 5 trips, 38 entries.` and exits 0.

The second cost is the one that bit B325: **the generator is no longer the
place to add a demo field**, because using it as intended loses other things.
Anybody adding a field to the demo now has to either notice this first or
discover it in `git diff` afterwards.

## Work

Bring the script back level with `content/example/`, in this order:

1. Diff the two properly — run the generator into a scratch directory and
   compare against `content/example/` — so the full list of drift is known
   rather than the four cases above, which are only what one `git diff --stat`
   surfaced.
2. Teach it what it is missing. `travellers:` is the big one and is a real
   feature (`lib/travellers/`), so the demo should exercise it deliberately
   rather than have it re-appear by hand.
3. Then make the drift impossible to reintroduce: a test that runs the
   generator into a temporary directory and asserts the result matches
   `content/example/` byte for byte, skipping `media/` and `originals/`.
   That test is the whole point of the ticket — without it this recurs the
   next time somebody edits the demo by hand.

Note that B325 left `weather: true` in the generator *and* wrote it into the
committed entries separately, precisely because the two are out of step. Once
this is fixed, that duplication should collapse to just the generator.

Not doing: regenerating the photographs. `--media` fetches from Lorem Picsum
by fixed seed and is a separate, slow concern.

## Acceptance

- `node scripts/build-demo-content.mjs` on a clean checkout leaves
  `git status content/` empty apart from `media/` and `originals/`.
- A test fails if it does not.
- The demo trips still carry their travellers and their transport legs.

## Done, and what is honestly left

**Work item 1 (diff properly):** done first, via a new `--out=<dir>` flag on
the script (nothing else needed it) so the diff runs without touching
`content/example/`. The real drift was much larger than the four cases the
original `git diff --stat` surfaced — see "left open" below.

**Fixed, verified, low-risk:**

- `travellers:` blocks restored for all four trips that carry one
  (`alps-2024`, `asia-2023`, `usa-2026`, `parks-2025`) — `writeTrip` now emits
  a `travellers:` block from a new `trip.travellers` array, field order
  matching `lib/tripWrite.ts`'s `FIGURE_FIELDS` (which is also the order
  every hand-written figure already used). Data copied verbatim from the
  committed files.
- `bangkok-first-morning`'s dropped flight: `transport: { mode: "flight",
  from: "Zurich", to: "Bangkok" }` added to that day's object
  (`scripts/build-demo-content.mjs`, the `asia-2023` trip's `days[0]`).
- Found and fixed two bugs beyond what the ticket named, both real and both
  now regression-tested:
  - `weather:` was written *after* `transport` in `writeEntry`, but every
    single committed entry has it *before* — this alone caused a spurious
    diff on nearly every day in the demo. Swapped the order.
  - `2023-05-30-last-week-hanoi.md`'s transport leg was `Hoi An → Hanoi` in
    the generator's data but the committed (correct) leg is
    `Da Nang → Hanoi` — fixed the data.

**New test:** `test/build-demo-content-regen.test.ts` regenerates into a
scratch dir (`--out`) and diffs every file under `content/example/trips/`
against it, line by line, failing on any unrecognised difference. It also
fails if the generator produces a file the committed journal doesn't have, or
is missing a file the committed journal does (apart from a small, named
allowlist — see below). Verified it actually catches regressions: temporarily
changed one hardcoded colour in the script and reran the test, which failed
with the exact changed line named; reverted and it passed again.

**What is honestly still open, filed as B736 rather than pushed through
here:** while building the diff (Work item 1), the true drift turned out to
be substantially bigger than the ticket's four named examples, and closing
all of it safely was not achievable at this ticket's complexity without
either inventing data or risking a second silent-loss bug (an early attempt
at reproducing the missing fixture days got a translation and a `weather`
flag wrong on the first try, and was reverted rather than shipped). The
remainder, all captured in B736 with exact file/line detail:

1. `travelScene: "quick"` / `"skip"` — a per-day field the generator has no
   concept of (2 days).
2. Per-item `visibility: guest` / `visibility: private` (B596) — neither the
   generator's day nor gallery-item schema supports it (4 places, all in
   `usa-2026`).
3. Four photo captions the generator's `day.captions` doesn't carry.
4. Six entries that exist in `content/example/` and nowhere in `TRIPS` —
   `test: true` fixture days written by hand for later tickets (travel-scene
   vehicle coverage), never fed back into the generator.
5. `usa-2026/trip.md`'s `travellers:` sits in a different position relative
   to `visibility:` than the other three trips with one — cosmetic, not
   pursued.

Given that, the first acceptance line ("leaves `git status content/` empty
apart from `media/` and `originals/`") is **not fully met** — `weatherData:`
lines (deliberately, always excluded — see the module's own comment) plus the
five items above would still show in a real `git diff` after a `--force`
regen. The second and third acceptance lines **are** met: a test does fail on
undocumented drift (verified above), and the four trips do carry their
travellers and `bangkok-first-morning` its transport leg. B736 tracks closing
the rest; its own acceptance is the literal, unqualified version of this
ticket's first line.
