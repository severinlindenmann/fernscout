---
id: B648
title: publish --dry-run cannot show a plan for a trip the instance does not have yet, and --offline still hits the network
type: ISSUE
priority: high
complexity: low
area: helper: publish
found: "2026-09-06T19:33:03Z"
---

# B648 — publish --dry-run cannot show a plan for a trip the instance does not have yet, and --offline still hits the network

## Why

`.claude/skills/publish/publish.mjs:444` does an unconditional
`GET …/{trip}/days`. For a trip the instance does not have, that answers
`404 unknown_trip`, which `refuse()` treats as fatal. So the first dry run of
any new trip prints:

```
── elsass-2025
  would create the trip

✗ GET …/elsass-2025/days
      404 unknown_trip
```

and stops. The person never sees the plan — which days, how many photographs —
at exactly the moment `publish/SKILL.md` calls "the one cheap moment to notice
that a trip is about to be created twice under two ids, or that fourteen days
are about to go up when they meant one". A dry run that cannot answer for a new
trip is useless for the case it matters most in.

**`--offline` does not help, though the documentation says it should.** Line 444
has no `offline` guard, unlike lines 386 and 598 which both have one, so
`--dry-run --offline` reaches the network anyway and dies on the same 404.

## Work

Two fixes, independent:

- Add the missing `offline ? { ok: false } : …` guard at line 444, matching the
  two places that already have one.
- When the trip is about to be created in this same run, treat a 404 from
  `GET …/days` as an empty list rather than a refusal — there cannot be days
  under a trip that is not there. Any other status stays fatal.

## Acceptance

`publish --dry-run` on a trip the instance does not have prints the whole plan —
the trip, its days, its photograph counts — and exits 0. `--dry-run --offline`
makes no request at all.
