---
id: B311
title: One guide holds every task, so an agent reads fifty kilobytes to write one day
type: FEATURE
priority: high
complexity: high
area: agent docs, routes
found: "2026-09-04T16:12:40Z"
---

# B311 — One guide holds every task, so an agent reads fifty kilobytes to write one day

## Why

The owner's proposal, 2026-09-04: **serve the guide as skill files.**
`/documentation.txt` stays a thin index and each task gets its own document —
`/skill/new-account.md`, `/skill/add-journal.md`, `/skill/add-a-day.md` — so an
agent fetches the one it needs and nothing else.

The measurements that make the case. `/agent.md` is **55.8KB** and
`/documentation.txt` is **12.4KB**, up from 3.7KB this morning. A real agent
creating one journal today fetched the 56KB guide **three times**, because no
single read left it holding the procedure. An agent asked to write one day
reads the whole of signup, invites, deletion, photobooks and the media limits
table to find three fields.

**The convention this project already chose specifies the fix.**
`lib/api/documentation.ts` says so in its own header:

> The structure follows llmstxt.org — an H1, a blockquote summary, prose, then
> H2 "file lists" of links with notes — because that convention also specifies
> **path scoping**, which maps exactly onto one document per user.

Path scoping is what is not being used. And the split it implies is one this
repository already believes in: `.claude/skills/` holds exactly these tasks by
exactly these names — `add-a-day`, `add-a-trip`, `ingest-photos`,
`send-postcards` — for an agent working on the files. AGENTS.md's own table
claims the two doors serve "the same content"; today the local door is nine
task-sized documents and the network door is one of fifty-six kilobytes.

## The trap, which a naive version walks into

**A discovered URL is not a fetchable URL.** B259 established, from a real
failure, that a claude.ai-class client fetches only what a person pasted or
what a search result named — a link found *inside* a fetched document is
refused, as an injection defence that will not be relaxed. B261 worked around
it by putting both URLs in the instruction the owner pastes.

So nesting nine skill files behind an index turns one refusable hop into nine.
An agent that cannot follow links would reach the index, learn that the answer
exists somewhere, and be unable to open it — which is worse than today, where
at least `/documentation.txt` carries signup end to end (B256, B259).

**Therefore the entry document keeps its floor.** Whatever else moves, it must
still, on its own, without a single hop: state the capability an agent needs
(B259), ask the questions (B307), and carry signup through to a published day.
That is not decoration — it is the property three tickets were spent building,
and the skill files are an optimisation on top of it, not a replacement for it.

## Work

Not designed yet. What has to be decided, roughly in order:

1. **What the split is.** Probably the flows that already have names in
   `.claude/skills/`, plus signup. Resist inventing a taxonomy: if a document
   does not correspond to something an owner asks for out loud, it does not
   need to exist.
2. **Where the line falls** between the entry document's floor and the skill
   files' depth. The honest test: could an agent that fetched only
   `/documentation.txt` still create a journal, a trip and a published day? It
   must remain yes.
3. **Generated from the same constants**, not written twice.
   `lib/api/agentCopy.ts` already exists for exactly this reason and every
   drift bug this project has had (B263, B277, B294) came from two places
   holding one fact. Nine documents multiply that risk by nine, and the answer
   is that all of them render from one structure.
4. **How an agent learns the skill files exist** — and whether the landing
   page's copied instruction should name more than two URLs, given B261. A
   list of nine in a pasted prompt is not an instruction anybody will paste.
   Consider instead that a *response* can name the next document: an API reply
   is not a fetched page, and `next:` fields already point agents onward.
5. **Whether `/agent.md` survives.** It may become the concatenation of the
   skill files, so that an agent which prefers one big read still has one — at
   no maintenance cost, since it is generated.

Supersedes the open question in **B308**, which asked how to give the documents
a shape and listed "separate the script from the reference" as its first
candidate. This is that, named properly. Close B308 into this one or keep it as
the measurement half — B308's byte-count ceiling is worth having either way,
and is the thing that would have caught this growth before it needed a
redesign.

Depends on **B307**: the question scripts are what the entry document's floor
is made of, and they are being written now.

## Acceptance

- An agent that needs to write a day can read one document under 10KB and do
  it, without fetching the guide.
- An agent that cannot follow a discovered link can still create a journal, a
  trip and a published day from `/documentation.txt` alone.
- No fact about the API appears in two documents from two sources; a test
  asserts the skill files and the guide render from the same constants.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
