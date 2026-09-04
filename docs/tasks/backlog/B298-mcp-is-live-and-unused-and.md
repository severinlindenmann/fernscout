---
id: B298
title: MCP is live and unused, and costs maintenance surface nobody exercises
type: CHORE
priority: medium
complexity: high
area: mcp, api, docs, tests
found: "2026-09-04T13:55:45Z"
---

# B298 — MCP is live and unused, and costs maintenance surface nobody exercises

## Why

Requested directly by the owner: MCP (`/api/mcp`, `lib/mcp/`) has no client
exercising it in production, and it costs real, ongoing surface for a
capability nobody is using right now — its own transport layer
(`lib/mcp/http.ts`, 235 lines), its own JSON-RPC dispatch
(`lib/mcp/server.ts`, 206 lines), 2,184 lines of tool definitions
(`lib/mcp/tools.ts`) that duplicate REST logic, 1,829 lines of tests
(`test/mcp.test.ts` + `test/mcp-create-journal.test.ts`), a whole provider
doc (`docs/providers/mcp.md`), and mentions scattered across ~20 other docs,
two skills, and a dozen-plus task files. REST (`/api/v1/...`) already does
everything MCP does — the two doors were always "the same operation," per
comments at `lib/api/entries.ts:640` and elsewhere.

This is a removal, not a permanent decision: MCP may come back later if a
real client shows up. Nothing about this task should make that harder than
necessary — REST stays exactly as it is today.

## Work

Full inventory and step-by-step removal in
`docs/plans/2026-09-04-remove-mcp.md` — six phases:

1. Relocate `lib/mcp/idempotency.ts` → `lib/idempotency.ts` (genuinely
   shared with REST's `create_day`; must move before `lib/mcp/` goes).
2. Delete the MCP-only code: `app/api/mcp/route.ts`,
   `app/api/well-known/oauth-protected-resource/route.ts`,
   `lib/mcp/http.ts`, `lib/mcp/server.ts`, `lib/mcp/tools.ts`, and the two
   OAuth-metadata rewrites in `next.config.ts:136-146`.
3. Delete `test/mcp.test.ts` and `test/mcp-create-journal.test.ts` whole;
   trim `test/journal-features.test.ts` and `test/agent-interface.test.ts`.
4. Trim the generated agent docs in `lib/api/documentation.ts` (four spots,
   including the whole `## The same thing as MCP` section).
5. Drop MCP from ~15 comments in otherwise-REST-owned code (table of exact
   before/after text in the plan).
6. Delete `docs/providers/mcp.md`; edit `AGENTS.md`, `README.md`,
   `docs/README.md`, `docs/architecture.md`, `docs/runbook.md`,
   `docs/running-locally.md`, `docs/TESTING.md`,
   `docs/qa/SCENARIOS.md` (drop section J), two skill files, and amend
   `docs/ROADMAP.md`'s decision log in place.

**Not doing:** touching `docs/plans/*.md` or
`docs/security/2026-09-04-sweep.md` (dated historical records, not
corrected to match later reality) or mass-editing the dozen-plus
`completed/`/`backlog/` tasks that mention MCP only in passing while
describing a fix that was really about REST or a shared function — their
REST-side content stays correct regardless of whether MCP still exists.

**Tasks this makes moot**, named in the plan for a person to close once
this merges (an agent does not move tasks to `completed/`): **B260**
(RFC 9728 metadata), **B175** and **B206** (both about `create_trip` over
MCP specifically). **B112** is not moot but needs its "MCP/API" wording
reworded to "the API" before anyone builds it, so it isn't scoped against a
door that no longer exists.

## Acceptance

- `POST /api/mcp` and `GET /.well-known/oauth-protected-resource` both 404
  (not 405, not an auth challenge — confirms the route is gone, not just
  broken).
- `npm run build && npx tsc --noEmit && npx eslint . && npx vitest run` all
  pass.
- `/agent.md`, `/documentation.txt` and `/<user>/documentation.txt` mention
  only REST as the agent-write path (`curl -s .../agent.md | grep -i mcp`
  returns nothing).
- `lib/idempotency.ts` exists and `create_day`'s idempotency-key behavior is
  unchanged (existing REST tests covering it still pass); `lib/mcp/` no
  longer exists.
- `grep -rn "mcp" --include="*.ts" --include="*.tsx" --include="*.md" .`
  (excluding `docs/plans/`, `docs/security/`, `docs/tasks/completed/`, and
  the unrelated chrome-devtools-mcp plugin) returns nothing outside the
  explicitly-left-alone categories.
