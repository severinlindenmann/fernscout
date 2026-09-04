---
id: B198
title: Every docs link in the README points one directory above where the file is
type: ISSUE
priority: low
complexity: low
area: docs
found: "2026-09-03T20:06:00Z"
started: "2026-09-04T05:58:30Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T05:58:30Z"
---

# B198 — Every docs link in the README points one directory above where the file is

## Why

`README.md:42` and every row of the documentation table at `README.md:115-124`
link to `docs/running-locally.md`, `docs/runbook.md`, `docs/architecture.md`,
`docs/ingest.md`, `docs/currencies.md`, `docs/config-upgrades.md`,
`docs/deploy-mail.md`, `docs/providers/`, `docs/TESTING.md` and `docs/qa/`.

None of those paths exist. `docs/` holds exactly three entries — `archiv/`,
`branding/`, `tasks/` — and every one of those files is under `docs/archiv/`.
Only the `branding/` link resolves.

AGENTS.md says "prose about the software … is in `docs/`, indexed from the
README", so the README is the index and it is the one document a new reader
opens first. Ten dead links in it is the first impression the project makes,
and on GitHub they are 404s rather than anything a reader can guess past.

Noticed while adding a section to `docs/archiv/running-locally.md` for B181.

## Work

Decide which is the mistake before fixing either:

- If the move into `archiv/` was intended, update the ten links.
- If `archiv/` was meant to hold superseded material and these files were swept
  in by accident, move them back out and leave the README alone.

Then consider a test — a link checker over `README.md` is a handful of lines
and this is the second time documentation has drifted from where it lives.

## Acceptance

- Every relative link in `README.md` resolves to a file that exists.
- Something fails if that stops being true.
