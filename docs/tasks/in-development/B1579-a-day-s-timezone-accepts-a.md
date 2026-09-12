---
id: B1579
title: A day's timezone accepts a fixed offset, which has no daylight saving, while the refusal says it will not
type: ISSUE
priority: medium
complexity: low
area: lib/validate/entry.ts, days, time
found: "2026-09-12T10:12:11Z"
started: "2026-09-12T10:25:41Z"
session: 615a7d13-b735-48b0-a399-bf28e199b7bb
claimed: "2026-09-12T10:25:41Z"
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
