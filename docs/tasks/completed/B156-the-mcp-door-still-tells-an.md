---
id: B156
title: The MCP door still tells an agent that publishing means editing a file, two tools away from publish_day
type: ISSUE
priority: high
complexity: low
area: mcp, docs, publishing
found: "2026-09-03"
started: "2026-09-03T19:27:30Z"
merged: "2026-09-03T19:34:07Z"
completed: "2026-09-04T05:32:25Z"
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

## What the grep found — it was six places, not five

The instruction to grep before closing was the right one. The claim lives in
**six** places on this door, and B28 updated three of them, not four:

| Where | Verdict |
| --- | --- |
| `lib/mcp/tools.ts:787` — the `create_day` reply | **false**, fixed |
| `lib/mcp/tools.ts:371` — the doc comment above it | **false**, fixed |
| `lib/mcp/server.ts:35` — the server's `INSTRUCTIONS` | **false**, fixed — not in the ticket |
| `lib/mcp/tools.ts:280` — the draft line in rendered markdown | true, left alone |
| `lib/mcp/tools.ts:601` — `publishDayTool`'s own doc | true, past tense, left alone |
| `lib/mcp/tools.ts:1132` — `create_day`'s description | true — says no *argument* publishes, which is accurate |

The third is the one worth noting, because it is the worst of them and the
ticket did not know about it. `INSTRUCTIONS` is commented "What every agent is
told before it calls anything. It is the one rule", and it said:

> There is no tool, argument or flag here that skips that step, and asking for
> one will not produce one.

So the false claim was not only in a reply an agent gets after writing a day —
it was in the first thing every agent reads on connecting, before it calls
anything at all. An agent that read the instructions and never called
`create_day` still came away believing publishing had no mechanism here.

## Work

- Replace the sentence at `lib/mcp/tools.ts:787-788` with the same rule the
  other artifacts state: publishing is a second, deliberate call —
  `publish_day` — that the person has to ask for. Said in the words
  `lib/api/documentation.ts:258` uses, so the two doors do not drift again.
- Fix the doc comment at `:369-375`, which is the reasoning that kept the
  string alive. It now records that it was the reasoning, so the next reader
  does not restore it.
- Fix `lib/mcp/server.ts` `INSTRUCTIONS`, which keeps the true half — nothing
  you *write* publishes — and adds the half that was missing: `publish_day`
  exists, is owner-only, is refused once, and holding both calls is not the
  same as being told to make the second one.
- Two tests in `test/mcp.test.ts`, pinning both surfaces an agent is handed.

## Acceptance

- `create_day` over MCP tells the agent that a person publishes with
  `publish_day`, and does not mention editing a file.
  **Met** — `test/mcp.test.ts`, "the reply names publish_day rather than
  telling the agent to edit a file". Fails against the old string with
  `expected 'Created lanterns-of-hoi-an as a draft…' to contain 'publish_day'`.
- No reply from any MCP tool says there is no tool that publishes.
  **Met** — "nothing the server hands an agent claims publishing has no tool"
  asserts over the `initialize` instructions *and* the whole `tools/list`
  response, so a future divergence in any tool description fails here too.
- B28's last acceptance bullet — all the artifacts describing the same rule —
  is then true, and B28 can be re-tested.
  **Ready to re-test.** Six places checked, three were wrong, three are fixed.

Verified with all four: `npx tsc --noEmit`, `npx eslint .` (0 errors),
`npx vitest run` (1787 passed, 2 skipped), `npm run build`.
