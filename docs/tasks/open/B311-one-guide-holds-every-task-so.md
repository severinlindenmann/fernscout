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

Built, 2026-09-11:

1. **The split**, exactly the nine names the owner proposed, no more and no
   fewer: `new-account`, `add-journal`, `add-a-trip`, `add-a-day`,
   `ingest-photos`, `invite-someone`, `costs`, `send-postcards`,
   `make-a-photobook`. Each is served at `GET /skill/<name>.md` from its own
   `app/skill/<name>.md/route.ts`, all thin wrappers around one
   `skillDocResponse()` in `lib/api/skillRoute.ts`.
2. **One source, sliced rather than re-described.** `lib/api/skillDocs.ts`
   does not write a second copy of any procedure. It cuts `agentGuide()`'s own
   rendered markdown at a fixed list of headings already in it (`MARKERS` in
   that file) and reassembles the pieces per document, so a sentence in a
   skill document is byte-for-byte the same sentence in the guide —
   `test/skill-docs.test.ts`'s "known slices reappear in the guide verbatim"
   asserts this for all nine. `lib/api/skillDocMeta.ts` holds only the slugs,
   titles and one-line summaries (kept apart from `skillDocs.ts` so
   `documentation.ts` can list the nine documents without importing the
   module that imports `agentGuide()` back from itself).
3. **`/documentation.txt` keeps its floor**, unchanged in kind: it still
   inlines a minimal trip, a minimal day and the publish call rather than
   pointing at a skill document for any of the three — `test/agent-interface
   .test.ts`'s "inlines a minimal trip, a minimal day, and the publish call"
   is the same pre-existing test, still green. What changed is only that its
   "Machine-readable" section now lists the nine `/skill/<name>.md` links
   (titles and summaries from `skillDocMeta.ts`) instead of the one
   `/agent.md` link, and the German pasted-prompt instruction
   (`ownerPromptDe`, B261) was trimmed back to naming `/documentation.txt`
   alone rather than growing to name nine.
4. **`/agent.md` is retired**: `app/agent.md/route.ts` now answers `301` to
   `/documentation.txt` rather than serving the 150KB guide. Every reference
   to `/agent.md` across the repo (excluding `node_modules`, `.next` and
   `docs/plans/`) was updated to point at `/documentation.txt` or the
   relevant `/skill/<name>.md` instead: `AGENTS.md`, `README.md`,
   `.claude/skills/keep-the-contract/SKILL.md`, `lib/api/openapi.ts`,
   `lib/api/agentCopy.ts`, `lib/api/errorCodes.ts` (`not_authorised`),
   `lib/helper/server.ts`, `lib/journals.ts` (the welcome mail), `proxy.ts`
   (added `/skill/:name.md` to the same exclusion list `/agent.md` was on),
   `instrumentation.ts`, `app/[user]/layout.tsx` (the `text/markdown`
   alternate link, now per-journal `/<user>/documentation.txt`),
   `app/docs/page.tsx` and `app/docs/api/page.tsx`.
5. **The `agentGuide()` function itself was not deleted.** It stays as the
   one place the prose is written and is no longer served directly — only
   `skillDocs.ts` and the test suite read it now — so the nine documents and
   the (retired) full guide can never disagree; `npm run unused` is clean
   with it kept.

Not built, and worth a separate look (captured as findings below, not fixed
here): `agentGuide()`'s own rendered size has grown to ~146KB (it was 55.8KB
when this ticket was found), well past the point where reading it directly
is any use to anyone — worth a B308-style byte-count ceiling on it, or on
retiring the concatenation itself once nothing depends on reading it whole.
`add-a-day.md` renders at 10164 bytes, under the 10KB ceiling but by under
100 bytes; a small addition to the day schema will need a corresponding trim
elsewhere in that document to stay under it.

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

## Decision, 2026-09-11

**Yes — split it.** Asked as a yes/no because B1384 was blocked on it: there
was no point correcting a 56KB file sentence by sentence only for this ticket
to re-split it. The answer is to split.

So B1384's `/agent.md` correctness pass waits on this ticket rather than the
other way round, and B1384 stays in `in-development/` until then.
