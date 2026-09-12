---
id: B1579
title: A day's timezone accepts a fixed offset, which has no daylight saving, while the refusal says it will not
type: ISSUE
priority: medium
complexity: low
area: lib/validate/entry.ts, days, time
found: "2026-09-12T10:12:11Z"
started: "2026-09-12T10:25:41Z"
merged: "2026-09-12T10:35:25Z"
---

# B1579 — A day's timezone accepts a fixed offset, which has no daylight saving, while the refusal says it will not

## Why

Found while driving B1578. `PATCH .../days/<slug>` with
`{"timezone":"+02:00"}` answers **200** and writes `timezone: "+02:00"` into
the day — while the refusal it would have raised says, in as many words:

```
expected: 'an IANA zone name, e.g. "Asia/Bangkok" — not an offset'
```

`checkTimezone` (`lib/validate/entry.ts:230`) asks `isUsableZone`, which asks
`Intl`. The comment beside it says an IANA name is *"checked the same way
`lib/digest/quiet.ts` checks the instance's own zone — `Intl` accepting it,
never a hand-kept list"*, and that was true when it was written. ECMA-402 has
since added offset time zones, so `Intl` accepts `+02:00` as readily as
`Europe/Zurich`, and only `Mars/Olympus` is still refused. The check did not
change; the thing it delegates to did.

**Why an offset is not a zone.** It carries no daylight saving. A day in
Zurich in July is `+02:00` and in January is `+01:00`, and `Europe/Zurich`
knows that while `+02:00` does not — so a day stamped with an offset renders
its local time an hour out for half the year, silently, on whichever side of
the change it was not written. The field exists to decide what a reader's
"their time" is computed against (B42), which is exactly the computation an
offset gets wrong.

Two things are wrong at once and the second is the worse one: the value is
accepted, and the message a caller reads promises it would not be.

## Work

Reject a zone that is not a region name — an offset, `UTC` aside if that is
wanted — rather than trusting `Intl` alone to mean what it used to.
`Intl.supportedValuesOf("timeZone")` is the list-free way to ask, and is
available on every runtime this project supports; failing that, requiring a
`/` in the name is a one-line rule that admits every IANA region name and no
offset.

Check `lib/digest/quiet.ts` in the same pass — it reads the instance's own
zone through the same helper and inherits the same widening.

## Acceptance

- `PATCH .../days/<slug>` with `{"timezone":"+02:00"}` is refused, naming the
  field, and writes nothing.
- `Europe/Zurich` and `Asia/Bangkok` are still accepted.
- A test covers an offset, a region name and a nonsense name, so the next
  change to the platform's own idea of a zone is caught here rather than by a
  reader an hour out.


## Built, 2026-09-12

`isUsableZone` (`lib/digest/quiet.ts`) rejects a leading sign before it asks
`Intl`. That covers every spelling the platform grew — `+02:00`, `+0200`,
`+02`, `-05:00` and `\u221202:00`, the Unicode minus, which is not the ASCII
hyphen and is what a naive check misses.

`Etc/GMT+5` and `UTC` stay accepted: real IANA names somebody can deliberately
choose, unlike an offset that arrived because a phone reported one.

**The allow-list was the other candidate and is worse.**
`Intl.supportedValuesOf("timeZone")` is case-sensitive where `Intl` itself is
not, so `europe/zurich` would start being refused; and it holds only canonical
names, so whether an alias like `Asia/Calcutta` survives would depend on the
runtime's copy of the tz database rather than on anything this project
decided. Written down because it is the obvious fix and it is a trap.

Both callers are covered by the one change — the day's own field, and
`journalTimezone()` reading `DIGEST_TIMEZONE`, which had the same hole for the
same reason.

### Evidence, driven against the real route

`PATCH .../days/over-the-susten` with each value:

| sent | answer |
| --- | --- |
| `+02:00`, `-05:00`, `+0200`, `+02`, `\u221202:00` | `invalid_entry`, field named |
| `Europe/Zurich`, `Etc/GMT+5`, `UTC` | accepted |
| `Mars/Olympus` | `invalid_entry` |

`test/validate-entry.test.ts` covers all five offset spellings plus the two
zones that must keep working, so the next change to the platform's own idea of
a time zone is caught here rather than by a reader an hour out.
