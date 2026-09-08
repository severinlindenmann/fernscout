---
id: B736
title: build-demo-content.mjs still cannot reproduce travelScene, per-item visibility, some captions, or six fixture days
type: CHORE
priority: low
complexity: medium
area: demo content, scripts
found: "2026-09-07T12:25:30Z"
started: "2026-09-08T05:52:43Z"
session: 41335894-5435-4167-8cb6-898e370cd6a9
claimed: "2026-09-08T05:52:43Z"
---

# B736 — build-demo-content.mjs still cannot reproduce travelScene, per-item visibility, some captions, or six fixture days

## Why

B541 fixed `scripts/build-demo-content.mjs`'s two named regressions (missing
`travellers:` blocks, and `bangkok-first-morning`'s dropped `transportMode`),
plus a `weather`/`transport` field-order bug that was causing a spurious diff
on nearly every entry, and a transport direction bug in
`2023-05-30-last-week-hanoi.md` (was "Hoi An → Hanoi", the committed real leg
is "Da Nang → Hanoi"). `test/build-demo-content-regen.test.ts` now regenerates
into a scratch directory and diffs it against `content/example/`, so any new
drift beyond what is listed below will fail that test.

What is left, discovered while building that diff and deliberately not
chased further in B541 (medium complexity, and this remainder is a
strictly larger job — a new field type and six new day entries, not two
missing lines):

1. **`travelScene: "quick"` / `"skip"`** — a per-day override the generator
   has no concept of at all. Present on
   `asia-2023/entries/2023-01-24-night-train-north.md` and
   `2023-04-18-hue-to-hoi-an.md`.
2. **Per-item `visibility: guest` / `visibility: private`** (B596) — neither
   the per-day nor the per-photo form exists in the generator's schema.
   Present on four `usa-2026` entries: `2026-06-19-utah-red-country.md`
   (one gallery item), `2026-07-28-sierra-smoke.md`, `2026-08-24-oregon-coast-evening.md`
   (whole entry), and `2026-08-24-oregon-coast.md` (one gallery item).
3. **Four photo captions** the generator's `day.captions` arrays don't carry:
   "The camera, put down for five minutes" (`bangkok-first-morning`), "The
   water going over, and the spray coming straight back up" and "Steps down
   into the fog, and nothing at the bottom of them" (`zion-narrows`), "One
   leaf still holding the rain" and "The beach at low tide, and one person on
   the whole of it" (`oregon-coast`).
4. **Six entries that exist in `content/example/` and nowhere in `TRIPS`**:
   `asia-2023/2023-01-08-leaving-zurich.md`, `2023-02-10-chiang-rai-by-car.md`,
   `2023-02-20-the-slow-bus-to-the-border.md`,
   `2023-03-05-up-the-hill-on-foot.md`, `2023-04-25-over-to-da-nang.md`, and
   `usa-2026/2026-06-03-denver-money.md`. These are `test: true` fixture days
   (plus one `visibility: private` update) written directly by hand for later
   tickets (travel-scene vehicle coverage) and never fed back into the
   generator. A first attempt at reproducing them in this session got the
   German translation and a `weather` flag wrong on the first try — safe to
   redo, but it is real work, not a copy-paste.
5. **`usa-2026/trip.md`'s `travellers:` sits before `visibility:`**, while the
   other three trips with a `travellers:` block put it after
   `costsVisibility:`. The generator (as of B541) always uses the latter
   position, which is what three of four trips already used; only `usa-2026`
   would need reordering to match, and reordering committed YAML for no
   functional reason wasn't judged worth it in B541.
6. **`weatherData:`** is deliberately still not modelled — see the module's
   own comment at the top of `scripts/build-demo-content.mjs`.
   `npm run weather:update` fills it from a live archive and it does not
   belong in a regenerable fixture; the regen test excludes it by design,
   not by oversight.

## Work

For each of 1–5: either extend `writeTrip`/`writeEntry`'s schema to support
the field and add it to the relevant `TRIPS` entry (items 1–3, 5), or write
the missing day objects carefully against the actual committed file, byte by
byte, translations included (item 4). Update `test/build-demo-content-regen.test.ts`'s
`KNOWN_GAPS`/`KNOWN_MISSING_FILES` as each item is closed, so the test keeps
proving there is no drift beyond what remains listed.

## Acceptance

`node scripts/build-demo-content.mjs --force` on `content/example/` leaves
`git status content/` empty apart from `media/`, `originals/` and
`weatherData:` lines — i.e. `KNOWN_GAPS` and `KNOWN_MISSING_FILES` in
`test/build-demo-content-regen.test.ts` are both empty.

## Outcome (2026-09-08)

All five open items closed; `KNOWN_GAPS` and `KNOWN_MISSING_FILES` are gone
from `test/build-demo-content-regen.test.ts` entirely.

- **1. `travelScene`** — written inside the `transport` block, since without a
  `transportMode` there is no leg for the override to apply to.
- **2. Per-item and per-day `visibility`** — `photoVisibility`, indexed from
  the first photograph like `captions`, and `day.visibility` for the whole
  update. Emitted after `caption`, which is where `lib/ingest/entry.ts` puts
  it: a demo file the product could not have written teaches the wrong shape.
- **3. Five captions** added to the days that carry them.
- **4. The six hand-written days** are in `TRIPS`, with a new `test: true`
  field for the five that are fixtures. `denver-money` is deliberately not one
  — it is a real update held back with `visibility: private`, and the only
  per-update narrow visibility in the demo. **A fixture day is also not a
  stop**: the derived `plan.md` route now filters `test: true` days out, or it
  would draw a journey nobody took.
- **5. `usa-2026/trip.md`** reordered to the generator's field order, which is
  what the other three trips already used.

**Three committed files were normalised rather than the generator bent to
them.** `bangkok-first-morning`, `zion-narrows` and `oregon-coast` put
`caption:` before `type:`; `alps-2024` and `mekong-slow-boat` put it after
`height:`, which is also what `lib/ingest/entry.ts` writes. Five caption lines
moved, so the demo journal now matches what the product itself produces.

**The test got stricter as a result.** It compared a *set* of lines, which is
what let item 5 hide — every line present, every line matching, in an order the
generator would rewrite on sight. With nothing left to be lenient for it now
compares whole files in order, which is the ticket's own acceptance:
`node scripts/build-demo-content.mjs --force` leaves `git status content/`
carrying nothing but `weatherData:` lines, verified by hand as well as by the
test.

Item 6 (`weatherData:`) stays out of scope by design, as the ticket says.
