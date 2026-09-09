---
id: B759
title: A statement of more than four hundred payments is silently cut short
type: ISSUE
priority: low
complexity: low
area: agent, costs
found: "2026-09-07T13:57:56Z"
started: "2026-09-08T20:52:47Z"
merged: "2026-09-08T21:01:59Z"
completed: "2026-09-09T16:46:53Z"
---

# B759 — A statement of more than four hundred payments is silently cut short

## Why

`app/api/helper/[user]/statement/apply/route.ts:132` caps the row list at 400
and reports `truncated` in its answer — and the screen never renders that
number. So a trip with six hundred payments shows four hundred, with nothing
saying the other two hundred exist.

The cap itself is reasonable on a phone. Being silent about it is the part that
is not: somebody reconciling a statement against their own bank app finds a
shortfall and no explanation for it.

Found while building B689.

## Acceptance

A statement with more rows than the cap says so on the screen, with the count.

## What was found and changed

Confirmed still real: `app/api/helper/[user]/statement/apply/route.ts` still
caps the preview at `SHOWN = 400` and returns `truncated: Math.max(0,
inTrip.length - SHOWN)` in its JSON. `components/AgentInbox.tsx`'s
`readWholeFile()` read `body.spending` into `rows` and threw the rest of the
body — including `truncated` — away: `setRows((body.spending ?? []) as
Row[])`, no line reading `body.truncated`. Nothing in the categorise-and-write
screen ever showed the number, exactly as the ticket says.

Changed:

- `components/AgentInbox.tsx`: added `truncated` state, set from
  `body.truncated` in `readWholeFile()` and reset alongside `rows` in
  `reset()`. When `rows && truncated > 0`, a line renders above the row list:
  `t("agent.inboxTruncated", { count: String(truncated) })`.
- `site/locales/en.json`, `de.json`, `hu.json`: added
  `agent.inboxTruncated` (+ `.one` plural) — "{count} more payments were read
  from this statement but are not shown here." / German / Hungarian.
- `lib/i18n.ts`: regenerated via `npm run i18n:keys`.
- `test/agent-inbox-truncated.test.tsx`: new component test (jsdom +
  `createRoot`, same harness as `test/helper-chat.test.tsx`) — asserts the
  truncated line appears when the route answers `truncated: 200`, and that no
  such line appears when `truncated: 0`. Fails against the pre-fix component
  (verified via `git stash`), passes after.

Not touched: the 400-row cap itself (reasonable per the ticket's Why), the
server route's computation of `truncated` (already correct), and nothing in
B760 (mapping/currency screen) or B761 (preamble line) — this is scoped to
`AgentInbox.tsx`'s read-the-whole-file step only.
