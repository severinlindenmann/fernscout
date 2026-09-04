---
id: B134
title: The review queue cannot tell a person which drafts nobody lived
type: ISSUE
priority: medium
complexity: low
area: api, mcp, test-content
found: "2026-09-03"
started: "2026-09-04T06:22:43Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T06:22:43Z"
---

# B134 — The review queue cannot tell a person which drafts nobody lived

## Why

Found while building B116, which fixed the same gap on two other surfaces and
deliberately did not absorb this one.

`listDrafts` (`lib/api/entries.ts:322`) returns `{ slug, title, date }` and
nothing else. Everything built on it inherits that:

- `GET /api/v1/<user>/drafts`
- MCP `list_drafts`, whose text ends *"Tell them what is here and ask which
  they want on the site; `publish_day` is the tool that acts on the answer."*

So the one list an agent is instructed to read back to a person **at the moment
they decide what goes on the site** cannot say that a draft is content nobody
lived — neither for a day carrying `test: true` itself nor, more likely, for
one inheriting it from a `test` trip.

This is the same class of failure as B47 and B116: the flag is on disk and
correct, and a readable surface omits it. It is arguably the worst instance of
the three, because the others are read while an agent is orienting itself and
this one is read while a person is being asked to publish. An agent that lists
five drafts and does not mention that two of them are inventions has handed
somebody a decision without the fact that decides it.

Not a data-loss bug. `publish_day` on a test day is still a person's deliberate
call, and the published page carries the banner.

## Work

- Carry the flag out of `listDrafts`, resolved the way every other surface
  resolves it: `isTestContent(trip, entry)`, so a day inheriting it from its
  trip is flagged. `listDrafts` reads files with `matter` directly rather than
  going through `getAllEntries`, so it does not currently have the trip — this
  is the part with a decision in it.
- Show it in `GET /api/v1/<user>/drafts` (present only when true, as B116 and
  B47 established) and say it in `list_drafts`'s text rendering, reusing
  `testContentNotice()` in `lib/mcp/tools.ts` rather than writing a third
  phrasing.
- One test per surface, on the inherited case.

Not doing: `test: false` on unflagged drafts. Absent means real.

## Acceptance

- `GET /api/v1/<user>/drafts` marks a draft that is test content, including one
  that inherits the flag from its trip.
- MCP `list_drafts`'s text says so, in the same words `get_day` and
  `list_trips` use.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.

## Built (2026-09-04)

The Why held up: `listDrafts` returned `{ slug, title, date }` and both surfaces
built on it inherited the gap.

- `lib/api/entries.ts` — `listDrafts` now reads the trip once, with `getTrip`,
  and resolves the flag with `isTestContent(trip, entry)`. That was the part
  with a decision in it: the alternative was routing the queue through
  `getAllEntries`, which filters drafts out and would have meant reading each
  file twice. `test` is present only when true.
- `GET /api/v1/<user>/drafts` carries it through the existing spread; the
  route's doc comment says so.
- MCP `list_drafts` says it on the draft's own line, through
  `testContentNotice("day")` — the same sentence `get_day` and `list_trips`
  use, not a third phrasing. The tool description now tells an agent to read
  that out with the rest.

Tests in `test/test-content.test.ts`: the inherited case through the REST route,
the entry's own flag beside a real draft, and that the queue and the day read
agree about the same day. `test/mcp.test.ts` covers the text rendering.

Not done, as planned: `test: false` on unflagged drafts. Absent means real.
