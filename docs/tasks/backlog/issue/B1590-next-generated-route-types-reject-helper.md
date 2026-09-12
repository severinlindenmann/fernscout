---
id: B1590
title: Next generated route types reject helper exports from two route modules
type: ISSUE
priority: high
complexity: low
area: next, build
found: "2026-09-12T14:22:50Z"
---

# B1590 — Next generated route types reject helper exports from two route modules

## Why

`npx next build --webpack` compiles the application and then fails its generated
route typecheck because two App Router modules export names Next does not
permit. `app/[user]/media/[...path]/route.ts` exports `parseRange`, and
`app/agent/page.tsx` exports `shouldUpgradeIdentity`; `.next/types` requires a
route or page module to expose only Next's supported entry points. This leaves
the production build red before an unrelated change can pass the repository
gate.

## Work

Keep both helpers testable without exporting them from App Router entry-point
modules, moving them to ordinary modules if their current tests need named
imports. Do not weaken or bypass Next's generated route checks.

## Acceptance

- `npx next build --webpack` passes its generated route typecheck.
- The existing tests for byte ranges and identity upgrades still pass.
- `npm run verify` passes in an environment where Turbopack may create its
  internal worker process.
