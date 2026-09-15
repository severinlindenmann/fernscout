---
id: B1781
title: Appearance is a panel on /me while language is a chip in the header
type: ISSUE
priority: medium
complexity: low
area: Header
found: "2026-09-15T06:38:10Z"
started: "2026-09-15T06:38:20Z"
session: 7163371b-1cbb-42e5-9fff-437a9b5a0580
claimed: "2026-09-15T06:38:20Z"
---

# B1781 — Appearance is a panel on /me while language is a chip in the header

## Why

Language, currency and the trip switcher are chips in the header, reachable
from every page. Appearance — the same kind of setting, a device preference
that changes nothing on the server — is a panel on `/<user>/me`, which means
finding the access page to turn the lights down. B1766 made that panel one row
rather than a card; this asks the further question of whether it belongs there
at all.

`components/ThemeSwitcher.tsx` is already the header-sized version of it and is
already on the landing page beside the language chip, so this is placing an
existing control, not building one.

## Work

- Drop `ThemeSwitcher` beside `LocaleSwitcher` in `PageHeader`, in both the
  phone panel and the `sm`-and-up row.
- Remove the `ThemePicker` panel from `/<user>/me`; delete the component and
  its strings if nothing else renders it.

## Acceptance

- The choice is reachable from every journal page at desktop and phone width,
  and the two stay in step (the `storage` listener already does that).
- `/<user>/me` loses the panel and nothing else moves.
