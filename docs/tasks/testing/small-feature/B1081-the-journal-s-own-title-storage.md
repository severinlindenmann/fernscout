---
id: B1081
title: The journal's own title, storage, keys and past conversations are unreachable from the conversation
type: FEATURE
priority: medium
complexity: medium
area: lib/helper/tools/areas/journal.ts
found: "2026-09-09T15:41:59Z"
merged: "2026-09-09T15:42:46Z"
---

# B1081 — The journal's own title, storage, keys and past conversations are unreachable from the conversation

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Everything about the journal itself — its title, what its storage is doing, the
keys that can write to it — was owner-page-only. And `sessionsOf()`, written for
B976 so an owner could reopen a conversation, had no caller at all: the sessions
were being recorded and were unreachable.

## Work

`journal_settings`, `cleanup`, `buy_room`, `keys`, `revoke_key`, `buy_credits`
(a link, because a link tool is synchronous and cannot file a transaction), and
`past_conversations`, which closes B1022.

`past_conversations` is why `Option` gained an `href`: pressing a `choose`
option says its label, and saying an old opening line back into the current
thread is the opposite of reopening it.

## Acceptance

The room lists past conversations and each one is a link to `/agent?c=<id>`
that opens it. `keys` never contains a token —
`test/helper-journal.test.ts` asserts that on the stringified result.
