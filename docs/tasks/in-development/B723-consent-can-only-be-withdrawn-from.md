---
id: B723
title: Consent can only be withdrawn from inside the wizard
type: FEATURE
priority: low
complexity: low
area: agent, ui
found: "2026-09-07T11:44:12Z"
started: "2026-09-09T05:44:39Z"
session: eef381a2-5a19-477a-a5ce-5f4f2d3dacab
claimed: "2026-09-09T05:44:39Z"
---

# B723 — Consent can only be withdrawn from inside the wizard

## Why

`docs/plans/2026-09-07-web-helper-agent.md` §6 says the model consent is
revocable from `/<user>/me`. B684 put the withdrawal in the same step-4 panel
that asked for it, on the argument that the panel that asked is where a person
looks — and that `MePageContent.tsx` was large and being edited by another
session at the time.

Both are true, and the plan's version is still the one a person will look for
when they are not in the middle of writing a day. A permission granted once
should be visible where the journal's other permissions are.

## Acceptance

The consent, its date and the provider are shown on `/<user>/me`, and can be
withdrawn there.
