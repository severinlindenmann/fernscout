---
id: B420
title: DELETE .../costs always answers costsPageGone true even when a day's costs: block keeps the page alive
type: ISSUE
priority: medium
complexity: low
area: costs api
found: "2026-09-05T08:51:36Z"
merged: "2026-09-05T09:08:37Z"
completed: "2026-09-05T09:37:23Z"
---

# B420 — DELETE .../costs always answers costsPageGone true even when a day's costs: block keeps the page alive

## Why

Found correcting B332's prose. `DELETE /api/v1/<user>/trips/<trip>/costs`
(`app/api/v1/[user]/trips/[trip]/costs/route.ts:204-223`) removes `costs.md`
and unconditionally replies:

```json
{"ok": true, "costsPageGone": true, "note": "... no longer exists ..."}
```

But B328 widened `hasCostsData` (`lib/costs.ts:90-93`) so the costs page
exists when *either* `costs.md` is present *or* any day carries a `costs:`
block. Deleting the budget on a trip whose days still log spend leaves the
page exactly where it was — `costsPageGone: true` is simply wrong on that
trip, not merely stale advice.

`deleteCosts` (`lib/api/costs.ts:244-255`) only removes the file; nothing in
the DELETE handler asks whether a day still carries costs before claiming the
page is gone. An agent trusting the response would report the page removed
when it is still live.

## Work

Have the `DELETE` handler check `hasCostsData(ref)` *after* removing the file
and set `costsPageGone` to that check's negation, rather than a hardcoded
`true`. Update the `note` to say the page survives when days still log spend.

## Acceptance

`DELETE .../costs` on a trip with a `costs.md` and no day-level costs answers
`costsPageGone: true`. The same call on a trip whose days still carry `costs:`
blocks answers `costsPageGone: false`, and a test pins both.
