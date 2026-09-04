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

---

## Resolution — 2026-09-04

**Same finding as B09 and B62. B09 carries the fix.** Reported here on
2026-09-03, five weeks after B09 and two days after B62 — three independent
captures of ten dead links in the first document anybody opens. That is the
case for the test.

The Work section asked the right question and named both answers. The move into
`archiv/` was intended, but `archiv/` did not mean what a reader takes it to
mean: not "superseded", but "written by an agent and never read by a person".
So the second answer is the one that shipped — the files moved back out, and
the provenance warning moved into `docs/README.md`, which can say the thing a
directory name cannot. B23 has the per-file reasoning; B09 has the full change.

One correction to the Why: `docs/branding/` was not the only link that
resolved — `AGENTS.md`, `CONTRIBUTING.md` and `TRADEMARK.md` in the README all
resolved too. The ten `docs/…` rows were the broken set, which the rest of the
description gets right.

## Acceptance — met

- Every relative link in `README.md` resolves — checked by
  `test/docs-links.test.ts`, together with `AGENTS.md`, `CONTRIBUTING.md`,
  every markdown file under `docs/` and every skill.
- Something fails if that stops being true. Demonstrated by appending a link to
  a file that does not exist to `README.md`: two tests fail, one naming the
  link and one naming the file that cites it. Removing it turns them green.
- The test skips `docs/tasks/` and `docs/plans/`, and says why in its own
  comment: a task file quotes the broken link it is reporting, and a plan is
  intent written before the work and never updated. This resolution note is an
  example — it would have failed the test it describes.
