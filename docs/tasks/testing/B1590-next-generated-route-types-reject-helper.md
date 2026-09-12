---
id: B1590
title: Next generated route types reject helper exports from two route modules
type: ISSUE
priority: high
complexity: low
area: next, build
found: "2026-09-12T14:22:50Z"
started: "2026-09-12T14:56:39Z"
merged: "2026-09-12T15:02:44Z"
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

Revalidated 2026-09-12: valid. The installed Next.js 16.3.3 documentation for
App Router pages and route handlers limits entry modules to Next's supported
exports. The two named helper exports are still present in
`app/agent/page.tsx` and `app/[user]/media/[...path]/route.ts`, and the webpack
production build reaches generated route validation before rejecting them.

## Acceptance

- `npx next build --webpack` passes its generated route typecheck.
- The existing tests for byte ranges and identity upgrades still pass.
- `npm run verify` passes in an environment where Turbopack may create its
  internal worker process.

## Implementation

- Moved `parseRange` to `lib/mediaRange.ts` and made the media route import it.
- Moved `shouldUpgradeIdentity` and the page's other test-only helper export,
  `arrivalFor`, to `lib/helper/pageState.ts`.
- Updated the focused tests to import the ordinary modules. The App Router
  entries now expose only Next-supported exports.

## Verification

- `npx vitest run test/media-range.test.ts test/agent-door-identity-upgrade.test.ts test/agent-page-arrival.test.ts` — 14 tests passed.
- `npx next build --webpack` — compiled, passed generated TypeScript route
  validation, generated all 91 static pages, and completed successfully.
- `npm run verify -- --quick` after that production build — types, ESLint,
  7,228 tests, and knip passed. ESLint reported the existing 71 warnings;
  restic and Postgres checks remained unavailable as reported by the suite.
- Manually reviewed the media permission route and identity-upgrade call site:
  this change only relocates pure helpers and does not alter either gate's
  inputs, order, or result. The optional `claude-security` reviewer named by
  the repository is not installed in this harness.
