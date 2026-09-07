---
id: B722
title: Nobody has checked whether the consent record is in a journal export
type: ISSUE
priority: low
complexity: low
area: export, agent
found: "2026-09-07T11:44:11Z"
started: "2026-09-07T12:55:02Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T12:55:02Z"
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

## Work done

Confirmed the Why: `appendUserContent` in `lib/exportZip.ts` queued only
`config.json` and `trips/**` — `helper-consent.json` was never included in
either scope.

`lib/helper/consent.ts:56` — exported the previously-private `consentFile()`
so the export code can find the same path the consent module itself reads and
writes, rather than reconstructing it.

`lib/exportZip.ts` — `appendUserContent` now queues `helper-consent.json`
**only when `scope === "all"`**. It is deliberately absent from
`"open-to-link"`: that scope is a packaging of content an anonymous visitor
could already reach (a plain GET carries nothing that says who is asking), and
the consent record is not content a reader ever sees — it is the owner's own
record of what they agreed to about the model. It belongs in the owner's own
full backup and nowhere an unauthenticated request can reach.

**Which archive variant carries it: `"all"` only. Never `"open-to-link"`.**

Test: `test/export.test.ts` — seeded `helper-consent.json` in the test
journal, added "carries the helper-consent record" under the `"all"` scope
describe block and "does not carry the helper-consent record" under
`"open-to-link"`. Both fail before the fix (the file was never queued at all,
so the `"all"` case failed) and pass after.
