---
id: B1814
title: A run of days with no country prints one Anderswo divider page each, not one chapter
type: ISSUE
priority: high
complexity: low
area: photobook, chapters
found: "2026-09-16T18:11:04Z"
---

# B1814 — A run of days with no country prints one Anderswo divider page each, not one chapter

## Why

Reported by the owner on 2026-09-16: a photobook shows the chapter heading
"Anderswo" far more often than a trip has unnamed stretches.

`chaptersOf()` (`lib/photobook/plan.ts:1029`) walks the days and starts a new
chapter whenever the country changes. It decides that with

```ts
if (last && last.country === day.country) { last.days.push(day); continue; }
chapters.push({ country: day.country || elsewhere, ... });
```

The comparison is between two different things. `last.country` is the
**resolved** chapter label — already `"Anderswo"` for a country-less day — and
`day.country` is the **raw** field, which is `""`. They can never be equal, so a
run of days with no country never merges. Three consecutive such days produce
three separate "Anderswo" chapters, and with `includeChapters` on
(`plan.ts:1147`) that is three divider pages. Days in Japan merge correctly,
because there both sides read `"Japan"`.

Confirmed by calling `chaptersOf` on three country-less days followed by one in
Japan:

```
[ {country:"Anderswo",days:1}, {country:"Anderswo",days:1},
  {country:"Anderswo",days:1}, {country:"Japan",days:1} ]
chapter pages titled "Anderswo": 3
```

`test/photobook.test.ts:548` covers a single isolated country-less day, which is
why this survived.

The heading itself is working as designed — `strings.ts:110/208/307` is the
chapter label for a day that names no country, and a day over open sea genuinely
names none. What makes it feel constant is the failure to group.

Why days lack a country at all is B1540, fixed on the export side in
fernscout-helper; the remaining instance-side causes (no GPS shared, the
`addressLookup` capability off, `reversePlace` timing out at
`lib/addressLookup.ts:383-421` and returning `null` in silence) are that
ticket's, not this one's. This ticket is the grouping.

## Work

In `chaptersOf`, compare like with like: resolve `day.country || elsewhere` once
per day and compare that against the chapter's label, or carry the previous raw
country alongside. Either is a couple of lines; take whichever reads plainer
beside the existing comment.

Watch that a country-less run still merges only when it is **consecutive** —
Japan, nothing, Japan is three chapters and stays three, which is the same rule
the function already applies to a revisited country.

Not doing: deriving a country from lat/lng at print time, changing the
"Anderswo" wording, or touching the day-creation paths. Those are B1540 and its
open remainder.

## Acceptance

- A test in `test/photobook.test.ts` covering several consecutive country-less
  days: one chapter, not one per day. It fails before the change.
- The existing single-day case still resolves to "Elsewhere".
- Japan / nothing / Japan still yields three chapters.
- Seen in a real render of a trip that has such a gap, not only in a fixture.
