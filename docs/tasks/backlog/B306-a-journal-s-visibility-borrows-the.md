---
id: B306
title: A journal's visibility borrows the trip's words for a different meaning, and everyone reads them as the trip's
type: ISSUE
priority: high
complexity: medium
area: visibility, agent docs
found: "2026-09-04T15:33:57Z"
---

# B306 — A journal's visibility borrows the trip's words for a different meaning, and everyone reads them as the trip's

## Why

Observed on 2026-09-04, driving a capable agent through signup. Asked for the
journal's visibility it offered *public or private*, correctly. The owner
answered **`guest`**. The agent explained the distinction and asked again. The
owner answered **`guest`** again.

That is not a person failing to read. It is the vocabulary being wrong.

Two levels, two meanings, one set of words:

| Level | Values | Decides |
| --- | --- | --- |
| Journal (`config.json`) | `public`, `private` | whether this server **advertises** it — the index, the landing page, `sitemap.xml` |
| Trip (`trip.md`) | `public`, `guest`, `private` | who may **read** it |

AGENTS.md is explicit that the first is not access — *"A private journal is
unlisted, not locked; who may read a journey is still the trip's own gate"* —
and the code agrees: a `private` journal's `public` trips are readable by
anyone who has the address. But `private` is the strongest word available at
the trip level, where it means *only the people who were there*. Reusing it one
level up for *not advertised* guarantees the misreading, and the person most
likely to make it is the owner deciding, at the one moment the decision is
taken.

The agent, for its part, behaved correctly throughout — it refused to send an
invalid value, said why, and proposed `private` journal plus `guest` trips.
B263's refusal did its job. The cost was three fetches of a 56KB guide and two
rounds of clarification for a question that should take one.

## Work

Not decided — the owner's model differs from what is built, and the gap is
worth thinking about rather than translating.

**What the owner asked for**, in their words: the journal should be *"either
guest or public"*, and then *"per trip we can select public, guest or
private"*.

Three ways to get there, in increasing cost:

1. **Rename, change nothing.** Journal visibility becomes `listed` /
   `unlisted` — words that cannot be mistaken for access, because access is
   not what they control. Cheapest, honest, and it makes the existing
   behaviour describable in one sentence. It does not give the owner the model
   they described.
2. **Rename, and make the journal's answer the default for its trips.** The
   owner's sentence reads as *"the journal decides the norm, the trip may
   differ"*, which is a default rather than a gate: a journal answered `guest`
   creates `guest` trips unless told otherwise. Cheap — one field consulted at
   trip creation — and it is probably what was actually wanted. Note that a
   new trip is currently `private` whichever kind of journal it is in, and
   that default is deliberate; changing it is the substance of this option,
   not a side effect.
3. **Journal-level access.** A gate in front of the whole journal, so
   `guest` means *nobody reads anything here without an invitation*. This is a
   real feature: a new check in every reading path, and a decision about what
   happens to a `public` trip inside a `guest` journal. Note that a journal
   whose every trip is `guest` already behaves this way, which is an argument
   that (2) delivers the intent and (3) is machinery for a case already
   covered.

Whichever is chosen, **both generated documents and the creation question have
to state the distinction in one line each**, because the current failure is
that a reader must hold two vocabularies at once to answer one question.

Not in scope: the trip's three values, which are well understood and were not
what anybody got wrong.

## Acceptance

An owner asked for their journal's visibility can answer correctly the first
time, from the question alone, without being told the difference between
listing and access. And whatever the values become, the documents and the API
refusal agree on them.
