---
id: B308
title: The entry document has tripled and the guide is 56KB, which is the property they were valued for
type: ISSUE
priority: medium
complexity: medium
area: agent docs
found: "2026-09-04T15:33:58Z"
started: "2026-09-07T11:40:30Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T11:40:30Z"
---

# B308 — The entry document has tripled and the guide is 56KB, which is the property they were valued for

## Why

Measured on 2026-09-04: `/documentation.txt` is **12.4KB** and `/agent.md` is
**55.8KB**.

**Re-measured on 2026-09-05, against fernscout.ch: 19.4KB and 83.7KB.** In one
day the small document grew by half again and the guide by half. Nothing has
been done about this task; it is getting worse at roughly the rate the code is
getting better, which is the argument for doing it. B311 is the structural
answer (one guide holding every task); this one is the measurement.

`/documentation.txt` was **3.7KB** at the start of the day. B256 inlined the
signup calls into it, B259 added the capability check and the whole minimum
write path, and B267, B277, B292, B293 and B294 each added a question or a
rule. Every one of those was right on its own terms, and the reason the first
of them existed was that the small document was **small enough to be fetched
and read** when the big one could not be:

> B256: *"the goal is that a failed hop costs the agent the rest of the API,
> not the whole of it."*
> B259: *"Watch the length — this document's value is that it is small enough
> to be fetched and read."*

That property has been spent by the tickets that depended on it. And the
symptom is already visible: the agent in B307's transcript fetched the 56KB
guide **three times** in one signup, because no single read left it holding the
procedure.

This is not an argument to delete any of it. Everything in there was put there
by a failure somebody actually hit. It is an argument that the growth now needs
a shape.

## Work

Not decided. Some directions, in the order they are probably worth trying:

- **Separate the script from the reference.** B307 wants a procedure an agent
  can follow from one read; most of the current bulk is explanation of *why*,
  which a capable agent does not need at the moment of acting and a weak one
  cannot use. A short script plus a deep reference is the conventional shape
  and it is what the two documents were originally meant to be — the entry
  document has drifted into being a second guide.
- **Ask what the entry document is for now.** B256 made it self-sufficient for
  signup because the hop to the guide could fail. B261 then made that hop
  reliable by putting both URLs in the pasted instruction. If the hop is
  reliable, the entry document can shrink back towards an index — but check
  whether B261's fix actually held before relying on it, because provenance was
  never the only failure mode.
- **Measure before and after.** Put the byte count in a test with a stated
  ceiling, so the next well-argued addition has to make a trade rather than
  simply fitting.

Do not solve this by cutting the parts that came from real failures. If
something has to go, it is the explanation, not the rule — and the explanation
belongs in `docs/` where a person reads it, not deleted.

## Acceptance

An agent can hold the whole of what it needs to create a journal, a trip and a
day after reading each document once, and the byte counts are asserted rather
than discovered.

## Done (2026-09-07)

**Re-measured, from the generators directly (`agentGuide()`/`instanceDocumentation()`
in `lib/api/documentation.ts`, not a live fetch) rather than trusting the
dispatch note's own numbers**: `/agent.md` is **129,854 bytes (126.8 KB)**,
`/documentation.txt` is **25,113 bytes (24.5 KB)**. Confirms the dispatch's
"triage pass" figures (128.6 KB / 25.1 KB) to within rounding — the small
document has not grown since, the guide has grown a little more.

**Did not restructure `instanceDocumentation()` into a pure index**, despite
the Work section's second bullet. Checked B261 (completed 2026-09-05): it did
land — the landing page's copied instruction now pastes both
`…/documentation.txt` and `…/agent.md` as absolute URLs in one sentence, so an
agent that only follows provenanced links has both from the start rather than
discovering `/agent.md` *inside* a fetched page and being refused it. That
argues the original B256 justification ("this document has to be
self-sufficient because the hop to the guide can fail") is weaker than it was.
But acting on it — cutting `documentation.txt` down to an index and trusting
the hop — is exactly the kind of "ask what the entry document is for now"
redesign this ticket's own text says is B311's job (splitting the guide by
task), not a size-ceiling ticket's. Diffed the two documents for literal
duplication instead: beyond the sentences already shared via `lib/api/agentCopy.ts`
imports (one source, deliberately, per the file's own comment), the two do not
repeat each other — `documentation.txt` is already the short version, not a
second copy of `agent.md`'s detail. There was no safe, "genuinely redundant"
cut available at this size that would not also be the restructuring B311 owns.
Raising this as a case *for* B311 rather than quietly doing part of it here.

**What this ticket actually delivers**: the ceiling test the third Work bullet
asked for. Added to `test/agent-interface.test.ts` (`describe("the documents
an agent reads")`):

- `agentGuide()` must stay under **135 KB** (current: 126.8 KB — headroom for
  one more well-argued paragraph, not a redesign).
- `instanceDocumentation()` must stay under **30 KB** (current: 24.5 KB).

Ceilings picked above the current size rather than at it, on purpose: a test
that fails on the very next line added would be indistinguishable from "no
test" the first time somebody has an actually good reason to add one sentence,
and would train whoever hits it to raise the number without thinking rather
than to ask the question the test exists to provoke. Both leave room for a
handful of paragraphs before the next breach, at which point raising the
ceiling needs a reason in the commit — the same discipline `openapi.ts`
already asks of a new `required` field. The comment beside the test says this
so the next person does not have to reconstruct it from a git blame.

**Acceptance, honestly**: the byte counts are now asserted rather than
discovered — that half is done. "An agent can hold the whole of what it needs
... after reading each document once" was not re-verified end to end (would
need a live signup transcript, which is B307's territory and this ticket's
time budget did not cover); nothing was cut that would make that claim
*less* true, since no content was removed.

`npm run verify` passes in full (build, tsc, eslint, all 341 test files, 4366
tests) with this change.
