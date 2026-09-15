---
id: B1792
title: Open signed-in owner's journal when launching the PWA
type: FEATURE
priority: medium
complexity: low
area: PWA launch, owner journal routing
found: "2026-09-15T09:28:50Z"
---

# B1792 — Open signed-in owner's journal when launching the PWA

## Why

When a signed-in owner opens the installed PWA, it currently lands on the
main page instead of their own journal. This adds an unnecessary navigation
step and makes the PWA feel disconnected from the owner's content.

## Work

Adjust the PWA launch/root routing so that an authenticated owner is sent
directly to their own journal. Preserve the existing main-page behavior for
visitors who are not signed in, and keep normal in-app navigation unchanged.

## Acceptance

- On launching the installed PWA while signed in as an owner, the first page
  shown is that owner's journal.
- The behavior works for every signed-in owner and does not depend on a
  hard-coded user or journal.
- A signed-out launch still opens the main page (or its existing
  authentication flow), with no redirect loop.
