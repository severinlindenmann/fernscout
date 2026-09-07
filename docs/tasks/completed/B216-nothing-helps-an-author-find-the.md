---
id: B216
title: Nothing helps an author find the rate to freeze into a trip
type: CHORE
priority: low
complexity: low
area: currency, tooling
found: "2026-09-04T06:33:41Z"
started: "2026-09-07T11:06:10Z"
merged: "2026-09-07T11:21:25Z"
completed: "2026-09-07T13:07:06Z"
---

# B216 — Nothing helps an author find the rate to freeze into a trip

## Why

Split out of B17, which documented the gap and stopped there. B17's fourth
work item was written as "consider", was not in its acceptance, and is a
feature rather than a correction — so it is captured here rather than absorbed.

A trip's `rates:` block is typed by hand. `npm run rates:update` refreshes
`content/rates/ecb.json`, which is layer three — the reader's display currency
— and writes nothing a trip can use. `docs/currencies.md` and
`.claude/skills/add-a-trip/SKILL.md` now say where the number comes from (a
card statement, or an ECB rate for a date in the middle of the trip,
cross-divided when the base currency is not the euro), but saying it is not the
same as handing over a figure to paste, and the cross-division is exactly the
step where somebody inverts the ratio.

## Work

- A read-only mode on `scripts/update-rates.mjs` — something like
  `npm run rates:update -- --pair THB --base CHF --on 2026-03-14` — that prints
  the cross-rate in the **trip** convention (base per one unit of the keyed
  currency), labelled as such, with the date it is for. The ECB publishes a
  history file at `eurofxref-hist.zip` alongside the daily one.
- Print it as a pasteable `rates:` line.

**Not doing, and this is the constraint rather than a shortcut: it must not
write into `trip.md`.** A frozen per-trip rate is a judgement about what a trip
actually cost — usually the spread the author really paid, which no reference
rate knows — and a command that fills the field in would replace that judgement
with a lookup while looking authoritative. Print it; let a person decide.

## Acceptance

- The command prints a number in the trip convention, and says which
  convention that is.
- Nothing under `content/` is modified by it.
- The four checks.

## Work done

Added `--pair`/`--base`/`--on` to `scripts/update-rates.mjs`:

```
npm run rates:update -- --pair THB --base CHF --on 2026-03-14
```

It fetches the ECB's 90-day history (`eurofxref-hist-90d.xml`, the same
document and override env var — `ECB_HISTORY_URL` — `lib/ecbHistory.ts`
already reads server-side for `fillTripRates`), finds the nearest publication
day on or before `--on` (the ECB does not publish on weekends), and prints the
cross-rate in the trip's own convention (`base` per 1 unit of `pair`) — the
same arithmetic as `crossRate` in `lib/currency.ts`, kept as a small local
copy for the reason this file already gives itself: a plain script reading a
fixed XML document should not need to import the server-only app. A date
older than the 90-day window is refused rather than guessed past, with a
pointer to the ECB's full `eurofxref-hist.zip` history for older trips —
matching the ticket's decision not to fetch or parse that archive here, since
a trip that old is asking for judgement call 1 or 3 in `docs/currencies.md`,
not a lookup.

**Writes nothing**, in either success or failure: the new mode is a fully
separate code path (`printCrossRate`) that never touches `fs`. The script's
existing `--dry-run` writing mode is unchanged and still the default path
when none of the three flags are given.

The script was restructured into named functions with a `main()` and an
"only run as CLI, not on import" guard (`process.argv[1] === ...`), the same
pattern `scripts/check-caddy.mts` already uses — needed so the pure lookup
functions could be unit tested without triggering the writing path or a real
network call.

Test: `test/update-rates-lookup.test.ts` — feeds `printCrossRate` a fake
90-day history via an injected `fetchImpl`, and asserts: the printed line
names the convention and the expected number; a weekend `--on` date falls back
to the nearest earlier publication day and says so; a date before the window
is refused with a pointer to the full history zip and writes nothing;
an unpublished currency is refused by name; and the CLI itself (`spawnSync`)
refuses a partial `--pair` with no `--base`/`--on` and does not touch
`site/rates/ecb.json`. `npm run verify` passed; `npm run unused` stayed clean.
