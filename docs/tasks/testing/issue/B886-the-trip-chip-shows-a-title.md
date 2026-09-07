---
id: B886
title: The trip chip shows a title long enough to truncate, which says less than a fixed label would
type: ISSUE
priority: medium
complexity: low
area: header, nav
found: "2026-09-07T20:20:00Z"
merged: "2026-09-07T18:50:38Z"
---

# B886 — The trip chip shows a title long enough to truncate, which says less than a fixed label would

## Why, and what was done

The owner, seeing B868 live: *"rather name it Trips 'Reisen', because if it is
the name of the trip it's too long"* — with a screenshot of
"Achtzehn Tage, elf …".

Right: B868 put the trip's own title on the chip, which is correct on a laptop
and wrong on a phone, where a real title arrives truncated and a truncated
title says less than a fixed word does.

Below `sm` the chip now carries **`trips.switch`** — "Switch trip" / "Reise
wechseln" — which was already this button's `aria-label`, so the visible and
accessible names finally agree. The title stays at `sm` and up, where the
fixed 14rem box has room for it.

**Not the literal word "Reisen"**, which is what was asked for: that is
`nav.trips`, a destination in the same panel listing every journey. Two
controls sharing a name while doing different jobs is a worse fault than a
long label, and it is only visible if you have both strings in front of you.
Say the word and it is a one-line change.

Measured at 390px: chip 137px, no truncation. The row still wraps — the four
chips need 345px against 332 — which is unchanged from B868 and was not what
the complaint was about.
