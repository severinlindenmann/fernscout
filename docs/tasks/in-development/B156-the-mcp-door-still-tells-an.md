---
id: B156
title: The MCP door still tells an agent that publishing means editing a file, two tools away from publish_day
type: ISSUE
priority: high
complexity: low
area: mcp, docs, publishing
found: "2026-09-03"
started: "2026-09-03T19:27:30Z"
session: ea97c35d-5c6a-4610-ab68-d1575d52ea4f
claimed: "2026-09-03T19:27:30Z"
---

# B156 — MCP still hands out the rule B28 retired

## Why

**This is why B28 fails on the live site.** Every other part of B28 works: the
REST and MCP publish calls both refuse the first time, the `confirm` code is
bound to journal, trip, day *and* verb, the five-minute expiry is real, and a
person who has never opened the content folder can publish. `AGENTS.md`,
`/agent.md`, `/openapi.json` and the welcome mail all describe the new rule
consistently.

One string did not get the message. Every successful `create_day` over MCP
replies:

```
Created b28-mcp-one-motion as a draft in xydhd-qa1/b30-originals.
It is not on the site. A person publishes it by removing the `status: draft`
line from the file — there is no tool, argument or flag here that does.
```

`lib/mcp/tools.ts:787-788`, with the same reasoning repeated in the doc comment
at `:369-375` ("There is no argument here that publishes, and there is no
second tool that does").

It is not merely stale. It is **false, and contradicted by the same server two
tools away** — `publish_day` is in the same `tools/list` response, and the agent
that just read this sentence can call it.

The cost is precise. An agent driving a journal over MCP alone — the door
`/agent.md` calls "a second door onto the same markdown files, not a second
system" — finishes writing somebody's day and is told the person must edit a
file the agent has never seen and cannot show them. That is verbatim the wall
B28's own "What a second agent run added" section quotes as the reason the
ticket exists, reproduced on one of the two doors.

The rest of the MCP publish path is correct: `list_drafts` returns the slugs
and says `publish_day` acts on the answer, `publish_day`'s own description is
right, and the confirmation binding holds over MCP including a cross-verb
attempt with a `delete_day` code. A day was published through MCP end to end.
It is one string and its comment.

## Work

- Replace the sentence at `lib/mcp/tools.ts:787-788` with the same rule the
  other four artifacts state: publishing is a second, deliberate call —
  `publish_day` — that the person has to ask for. Say it in the words
  `/agent.md` uses, so the two doors do not drift again.
- Fix the doc comment at `:369-375`, which is the reasoning that kept the
  string alive.
- Grep MCP's other replies for the same claim before closing. A rule stated in
  five places got updated in four.

## Acceptance

- `create_day` over MCP tells the agent that a person publishes with
  `publish_day`, and does not mention editing a file.
- No reply from any MCP tool says there is no tool that publishes.
- B28's last acceptance bullet — all the artifacts describing the same rule —
  is then true, and B28 can be re-tested.
