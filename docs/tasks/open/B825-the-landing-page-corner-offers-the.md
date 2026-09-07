---
id: B825
title: The landing page corner offers the operator a way in and everybody else nothing
type: FEATURE
priority: medium
complexity: low
area: landing, agent
found: "2026-09-07T17:40:00Z"
---

# B825 — The landing page corner offers the operator a way in and everybody else nothing

## Why

Asked for: *"on the main page, add next to Betrieb — this is admin only, but I
mean for non-admin also — a button 'Agent'."*

`components/LandingSections.tsx:126` renders a small chip pair in the corner of
the landing header: an "operator" link to `/admin`, shown only when `admin` is
true, beside the locale switcher. Everybody who is not the operator gets the
locale switcher alone.

Since B797 every page *inside* a journal carries a route to `/agent`. The
landing page — the one page a person actually starts on — does not have one in
its header. The corner is where it belongs, drawn as the operator link is, so
the two read as the same kind of control.

## Work

- An "Agent" chip in that corner, to `/agent`, for everybody rather than for
  the operator only.
- Drawn as the operator chip and the locale switcher are — `min-h-11`, the
  same subtle treatment — because three controls in one corner have to read as
  one set. This is the corner, not the hero: the hero already has the primary
  call to action, and a second loud one beside the language switcher would
  fight it.
- **Gate it on the `helper` capability.** With it off there is no `/agent`
  worth sending anyone to, and every self-hoster has it off by default.
- The operator link keeps its own admin gate, unchanged.

## Acceptance

- Signed out or in, with `helper` on, the landing corner offers Agent.
- With `helper` off it is absent and the corner is what it is today.
- The operator link is still admin-only.
- All three chips ≥44px, in one row at 390px, with no wrap.
