---
id: B1047
title: Two sessions running verify in the shared checkout collide on the next build lock
type: DOCS
priority: low
complexity: low
area: AGENTS.md, scripts/verify.mjs
found: "2026-09-09T06:45:12Z"
superseded: B1046
---

# B1047 — Two sessions running verify in the shared checkout collide on the next build lock

A duplicate of B1046, made by running `npm run tasks -- new` twice: the first
call printed a detached-HEAD warning about a sibling worktree and no id, which
read as a failure, so it was run again. It had already taken B1046.

Ids are forever, so this file stays rather than being deleted. The work is in
B1046.
