---
id: B183
title: MCP advertises the invite tools to a journal that has contacts switched off
type: CHORE
priority: low
complexity: low
area: mcp, capabilities
found: "2026-09-03T19:46:29Z"
started: "2026-09-04T06:22:43Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T06:22:43Z"
---

# B183 — MCP advertises the invite tools to a journal that has contacts switched off

## Why

Noted in B153 and left out of it deliberately, because it is cosmetic and that
task was about a journal being unable to share itself at all.

MCP's `tools/list` advertises `create_invite`, `list_invites` and
`revoke_invite` to a token whose journal has `contacts` off. Calling one is
refused clearly — `isEnabled("contacts", session.owner)` at
`lib/mcp/tools.ts:471` — so nothing breaks and nothing leaks. But the tool list
is how an agent decides what it can do here, and offering three tools that
cannot work is a list that has to be corrected by trying them.

The rest of the codebase is unusually consistent about the opposite: a disabled
capability is *absent* rather than broken (`AGENTS.md`), and B74 fixed exactly
this shape in the UI — an owner following a link their own page had drawn, to a
404.

## Work

Filter `toolsFor(session)` by capability, so a tool whose feature is off for
this journal is not listed. `toolsFor` already takes the session, so the
journal is known at the point the list is built.

Check whether any other tool is capability-gated in its handler and unfiltered
in the list — `add_media` and the postcard/photobook tools, if they exist, are
worth the same look.

Keep the refusal on call. A client may have cached an older list, and the
handler's check is what actually enforces this; the filter is honesty, not
security.

## Acceptance

- `tools/list` for a journal with contacts off does not include
  `create_invite`, `list_invites` or `revoke_invite`.
- The same journal with contacts on does include them.
- Calling one anyway is still refused with the existing message.

## Built (2026-09-04)

A `requires` field on the registry entry, named beside the handler that already
refuses without it, and `toolsFor` filters on `isEnabled(t.requires,
session.owner)`.

**One thing the Work section did not anticipate, and it is the interesting
part.** `callTool` resolved its tool through `toolsFor` as well, so filtering
that one function turned the clear "contacts are not enabled for this journal"
into "unknown tool" — the opposite of the acceptance criterion, which asks for
the existing refusal to survive. Listing and calling are therefore now two sets:
`callableTools` is the signup split alone and is what `callTool` uses;
`toolsFor` is that, narrowed by capability, and is what `tools/list` renders. A
client holding a list it fetched before the capability changed still gets the
sentence rather than a shrug, and the filter stays what the task says it is —
honesty, not security.

The sweep the Work section asked for: `isEnabled` appears in `lib/mcp/tools.ts`
exactly twice, both for `contacts`. There are no postcard or photobook tools,
and `add_media` is gated by trip access and size limits rather than by a
capability. The three invite tools were the whole of it.

`test/mcp.test.ts`: the tool list with contacts off (which is what the fixture
instance is) omits all three; with contacts switched on at both levels it lists
them; and calling one with contacts off is still refused in the handler's own
words. The existing "every tool an agent may call" assertion was updated and now
documents why the invite tools are not in it.
