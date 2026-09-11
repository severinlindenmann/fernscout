---
id: B1540
title: The country is in every exported photo and the helper throws it away, so the photobook says "elsewhere" on every day
type: ISSUE
priority: medium
complexity: low
area: helper, photobook, content
found: "2026-09-11T21:55:00Z"
---

# B1540 — The country is in every exported photo and the helper throws it away, so the photobook says "elsewhere" on every day

## Status — fixed in fernscout-helper

`build.mjs` now writes `country:` from the export metadata. The journal that
found it was backfilled by hand and re-published — 21 days Thailand, 2 days
Schweiz.

`countryCode:` is deliberately **not** written: mapping a country name to ISO
3166 is a table this repository would have to keep current, and a wrong flag is
worse than no flag. The instance accepts one without the other. Whether the
helper should carry that table is the open question below.

## Why

Reported by an owner on 2026-09-11:

> my photobook tells for title elsewhere on all days… for other trips it works

It works for their other two trips because those carry `country` and
`countryCode`; this one carried neither, on all 23 days, and the photobook falls
back to "elsewhere".

The information was never missing. osxphotos hands back the **whole** place
string:

```
Zurich Airport, Rümlang, Canton of Zürich, Switzerland
```

and `build.mjs` read `place.split(",")[0]` for `location:` and discarded the
rest. The country was in every one of the 284 exported photographs and in
`photos.json` on disk the entire time.

`validate-content` tipped `country` and `countryCode` as unset — correctly, and
as two lines among 247 tips on a run reporting zero errors. A tip is the right
severity for an optional field. It is the wrong severity for the difference
between a photobook with chapter titles and one that says "elsewhere"
twenty-three times, and nothing connected the two.

## Work

Done for `country`. Left open:

- **`countryCode`, and therefore the flag.** Options: a small table in the
  helper (brittle, and wrong for anything outside it), ask the instance (there
  is no lookup route today — see the `addressLookup` capability, which is about
  something else), or let the instance derive the code from the name on write.
  The last is the only one that scales, and it belongs here rather than in the
  helper.
- **The name comes out in the Mac's language.** Photos returned "Switzerland"
  on an English-language Mac for a journal written in German, where
  `elsass-2025` says "Schweiz". So the same owner's three trips now disagree —
  `algarve-2026` is in English, `elsass-2025` in German. If the instance derived
  the code, it could also offer the name in the journal's `defaultLocale`, which
  would settle this properly.
- **A day with no country should say so louder.** Not an error — a day over the
  Andaman Sea genuinely has no country, and Photos names the sea instead, which
  is why the fix takes the day's most common answer rather than the first
  photo's. But a whole *trip* with no country on any day is a different thing
  from one day missing it, and is worth a warning in `validate-content`.

## Acceptance

- A trip exported from Photos carries `country:` on every day that has one.
- A day over water is left without one rather than given the sea's name.
- A trip where no day has a country is flagged more loudly than a tip.
- The country name agrees with the journal's own language, or the instance
  supplies it.
