---
id: B761
title: A statement with a preamble line takes the wrong row as its header
type: ISSUE
priority: low
complexity: low
area: importers
found: "2026-09-07T13:57:57Z"
started: "2026-09-08T21:02:11Z"
merged: "2026-09-08T21:11:50Z"
completed: "2026-09-09T16:47:20Z"
---

# B761 — A statement with a preamble line takes the wrong row as its header

## Why

`importers/costs/mapping.ts:113` takes the first line with three or more cells
as the header row. Plenty of banks put a preamble above it — an account name, a
date range, an export timestamp — and a preamble line that happens to contain
two commas is taken as the header.

The person then sees nonsense column names in the picker, with no explanation
and no way to say "that is not the header". The model is shown the wrong header
too, so its mapping is wrong for a reason nobody can see.

Found while building B689.

## Work

An escape hatch on the screen — "that is not the header row" — that moves the
guess down a line. Cheaper than trying to be cleverer about detection.

## Acceptance

A statement with a two-line preamble can be imported without editing the file
first.

## What was found and changed

Confirmed still real: `importers/costs/mapping.ts:113` (`readTable`) took the
first line with three or more cells as the header, with no way to say
otherwise. A fixture with an account-name line and an export-date line above a
real header — each with three cells of its own — was mistaken for the header,
exactly as the ticket describes; `test/helper-statement.test.ts`'s new
"without the escape hatch, the preamble is read as the header" case shows it.

Changed:

- `importers/costs/mapping.ts`: `readTable(text, skipLines = 0)` now ignores
  that many non-blank lines before looking for a header at all.
  `statementSample(text, rows, skipLines)` and
  `applyMapping(text, mapping, skipLines)` both forward it, so the sample a
  model sees and the whole file `applyMapping` reads use the same offset.
- `app/api/helper/[user]/statement/route.ts`: accepts `skipLines` on the
  request (clamped 0-20), threads it into `statementSample`, includes it in
  the idempotency fingerprint (so a retry at a new offset is not silently
  answered with the first guess), and echoes it back in the response.
- `app/api/helper/[user]/statement/apply/route.ts`: accepts the same
  `skipLines` and threads it into `readTable`/`applyMapping` for the
  mapping-based path, so reading the whole file uses the same header the
  person confirmed.
- `components/AgentInbox.tsx`: a "That is not the header row" button next to
  the mapping picker. Pressing it re-reads the statement with `skipLines`
  incremented by one, using a distinct idempotency key (`<id>:skip<n>`) so the
  retry is a fresh model call rather than a replay of the wrong answer, and
  passes the confirmed `skipLines` on to the whole-file read.
- `site/locales/{en,de,hu}.json` + `lib/i18n.ts`: new key
  `agent.inboxNotTheHeader`.
- `test/helper-statement.test.ts`: unit coverage in `importers/costs/mapping`
  for the preamble fixture (wrong without `skipLines`, right with it, applying
  identically to a clean file), plus a route-level "a statement with a
  preamble line" suite covering the wrong-by-default read, the fixed read with
  `skipLines: 2` feeding into `/apply`, and that a repeated skip level replays
  rather than spending another credit. All fail against the pre-fix code
  (verified via `git stash`) and pass after.

Not touched: bank-specific parsers under `importers/costs/*.ts` (own headers,
out of scope), and B760's mapped-statement exchange-rate question (different
file, not overlapping).

### Acceptance, walked through

"A statement with a two-line preamble can be imported without editing the
file first" — `test/helper-statement.test.ts`, describe block "a statement
with a preamble line": staging a file with two preamble lines above a real
header, calling `POST /api/helper/[user]/statement` with `skipLines: 2` finds
the real header (`fixed.body.header` equals the real header, not the
preamble), and `POST /api/helper/[user]/statement/apply` with the same
`skipLines` reads all five payments (`whole.body.read === 5`) — nobody edited
`export.csv`.
