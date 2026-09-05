---
id: B308
title: The entry document has tripled and the guide is 56KB, which is the property they were valued for
type: ISSUE
priority: medium
complexity: medium
area: agent docs
found: "2026-09-04T15:33:58Z"
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
