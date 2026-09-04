---
id: B297
title: A NUL byte in the idempotency key separator makes git treat the whole file as binary
type: CHORE
priority: low
complexity: low
area: mcp, tooling
found: "2026-09-04T13:50:22Z"
superseded: B298 deleted lib/mcp/idempotency.ts
---

# B297 — A NUL byte in the idempotency key separator makes git treat the whole file as binary

## Why

> **Superseded, 2026-09-04.** `lib/mcp/idempotency.ts` no longer exists —
> B298 removed MCP — and `grep -rlP '\x00' lib app scripts` now matches
> nothing, so there is no file for git to read as binary. The lesson survives
> the file and is worth carrying into any future cache key: a literal NUL in
> source buys an unambiguous delimiter and costs the whole file's diffability.

Found while reviewing B292. `lib/mcp/idempotency.ts` builds its cache key as

```
`${owner}\x00${tool}\x00${supplied}`
```

with two literal NUL bytes in the source, not the escape sequence. Confirmed on
`main` and pre-existing — `git show HEAD:lib/mcp/idempotency.ts` has them, so
nothing in this session introduced it.

**As a delimiter it is defensible.** NUL cannot appear in any of the three
values, so the key is unambiguous in a way a space is not, and that is the
classic reason to reach for it.

**The cost is that git no longer reads the file as text.** `file` reports it as
`data`, `git diff --stat` renders it as `Bin … bytes`, and there is no line
diff and no useful `git blame` on a module that is small, subtle and about
correctness under retry — exactly the file where reviewing a change line by
line matters. B292's agent hit this and had to work around it.

The ambiguity NUL is protecting against is also not reachable here. `owner` is
a username, constrained to lowercase letters, digits and dashes; `tool` is one
of a fixed set of identifiers in this codebase; only `supplied` is caller
text, and it is the last segment, so nothing after it can be confused with it.
A separator that cannot occur in the first two values is enough, and almost any
printable character qualifies.

## Work

Replace the two NUL bytes with a printable separator that cannot occur in a
username or a tool name — a space is what the file appears to contain when
read in a terminal, which is its own argument for choosing something visible
instead. Say in a comment why the separator exists at all, since that is the
part a future reader will otherwise remove as noise.

**This changes every existing key**, which is harmless and worth stating: the
store is per process and in memory (the module doc says so at length), so it is
empty on every restart and a deploy discards it regardless. No migration, no
compatibility window.

While there, check nothing else in the repository carries stray control
characters — one command, and the answer is worth knowing once.

## Acceptance

`file lib/mcp/idempotency.ts` reports text, `git diff` on it produces a line
diff, and the idempotency tests still pass unchanged.
