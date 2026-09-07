---
id: B825
title: The landing page corner offers the operator a way in and everybody else nothing
type: FEATURE
priority: medium
complexity: low
area: landing, agent
found: "2026-09-07T17:40:00Z"
started: "2026-09-07T15:37:14Z"
merged: "2026-09-07T15:47:10Z"
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

## Done

Built in `.claude/worktrees/b825-landing-agent-chip`.

- `SiteHeader` (`components/LandingSections.tsx`) takes a new `helperEnabled`
  prop and renders an `Agent` chip to `/agent` beside the operator chip and
  `LocaleSwitcher`, drawn identically to the operator chip: `min-h-11`,
  transparent border, no fill, `hover:bg-cream-100`. `Landing.tsx` threads
  `helperEnabled` (already a prop, driven from `isEnabled("helper")` in
  `app/page.tsx`) down to `SiteHeader` — no second source of truth.
- New locale key `home.agentLink` ("Agent" / "Agent" / "Ügynök") added to
  `en.json`, `de.json`, `hu.json` right beside the existing `home.agentTitle`
  ("Your agent", the signed-in heading, left untouched). `npm run i18n:keys`
  regenerated `lib/i18n.ts`.
- Two new tests in `test/landing.test.tsx`: chip present (`>Agent<`) with
  `helperEnabled=true`, absent with it false/default.
- `npm run verify` (full, no `--quick`): all four gates green — build, tsc,
  eslint, vitest (376 files / 4703 tests passed, 3 skipped).

**Measured in a real browser at 390×844** (helper on, credits on — required
dependency, signed out so no operator chip): the Agent chip alone measured
57.5×44px. Height meets the 44px floor. With only two chips in the corner
(Agent + locale switcher) there was no wrap and plenty of spare width;
**the operator chip was not exercised in this pass** (no admin session in
this environment) so the three-chip-in-one-row case was not measured
directly — the operator chip is visually and structurally identical
(`min-h-11`, same font size, roughly the same width for "Operator" vs.
"Agent"), and with two chips using well under half the available width at
390px, three should still fit, but a person merging this should eyeball it
signed in as the operator with `helper` on before calling the acceptance
line fully closed.

Screenshots (helper off — unchanged corner with locale switcher only; helper
on — Agent chip visible, hero's "Start writing" unaffected) were reviewed and
matched expectations; not attached to this file.

## The three-chip case, measured after the build

The build could not exercise it — no admin session was available in that
environment — and it is the acceptance line most likely to fail, because a
wrapped corner is the fault the owner had just complained about in the journal
header. Measured instead by cloning the Agent chip in the live DOM into the
operator's position, so the markup, classes and fonts are the real ones:

| chip | width | height |
| --- | --- | --- |
| Betrieb | 66px | 44px |
| Agent | 58px | 44px |
| EN | 56px | 44px |

All three sit on one baseline at 390px (`distinctRows: 1`), and the row's own
height is 44px with three chips exactly as with two. It fits, with room to
spare. The acceptance line is closed.
