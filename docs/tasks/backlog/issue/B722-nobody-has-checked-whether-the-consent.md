---
id: B722
title: Nobody has checked whether the consent record is in a journal export
type: ISSUE
priority: low
complexity: low
area: export, agent
found: "2026-09-07T11:44:11Z"
---

# B722 — Nobody has checked whether the consent record is in a journal export

## Why

B684 stores the model consent as `content/<user>/helper-consent.json` — a file
rather than a row, deliberately, so it travels in the journal's own backup and
export and revoking is deleting it.

Nobody checked that `lib/exportZip.ts` actually includes it. If it does not,
the reasoning for the file is half true: the record is the journal's, and the
journal's export does not carry it.

## Acceptance

A journal export contains `helper-consent.json` when one exists, and a test
asserts it.
