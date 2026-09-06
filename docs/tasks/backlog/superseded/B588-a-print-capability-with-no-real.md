---
id: B588
title: A print capability with no real provider looks the same as one that can post
type: FEATURE
priority: medium
complexity: medium
area: self-hosting, capabilities
found: "2026-09-06T14:28:25Z"
superseded: "B492 — built directly as this ticket's small, safe slice"
---

# B588 — A print capability with no real provider looks the same as one that can post

## Why

`isEnabled("postcards")`/`isEnabled("photobook")` (`lib/capabilities.ts`)
reported `true` for the default `dry-run` provider exactly as readily as for a
real, credentialed one — correct for local development, but it meant an
operator who turned the flag on with no printer account (the exact situation
a self-hosted instance starts in, per B492) saw a capability that claimed to
be on, with nothing anywhere saying pressing the button would not actually
reach a printer.

## Work

Done. `resolveOne()` now attaches an optional `note` to an `enabled: true`
`postcards`/`photobook` state when the configured provider is `dry-run`
(`dryRunNote()`), and `/api/health` surfaces it. `enabled` itself is
unchanged — the capability genuinely is on, an order can still be composed —
this only stops "enabled" from silently meaning "and it will print" when it
does not.

## Acceptance

`test/capabilities.test.ts` — "postcards on dry-run is enabled, and says
nothing will actually print", and its siblings for the provider-named,
photobook, and fully-configured-provider cases.

