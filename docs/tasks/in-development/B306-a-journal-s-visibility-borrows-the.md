---
id: B306
title: A journal's visibility borrows the trip's words for a different meaning, and everyone reads them as the trip's
type: ISSUE
priority: high
complexity: medium
area: visibility, agent docs
found: "2026-09-04T15:33:57Z"
started: "2026-09-04T15:37:27Z"
session: 986bc24c-6a18-473f-a506-aa8c4efb475c
claimed: "2026-09-04T15:37:27Z"
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

**Decided by the owner on 2026-09-04: option 2 — rename, and make the
journal's answer the default for its trips.**

```
Journal: public | guest            ← also sets the default for new trips
Trip:    public | guest | private  ← may still differ, per trip
```

A `guest` journal creates `guest` trips unless told otherwise; a `public`
journal creates `public` ones. The journal sets the norm and the trip may
depart from it, which is the model the owner described and the one the two
vocabularies were failing to express.

Four things this has to get right, and the first is the one that can do real
harm.

1. **Every journal on disk today says `public` or `private`, or says nothing.**
   `private` must keep working, and must keep meaning unlisted — read as
   `guest` under the new vocabulary. An unrecognised value read as `public`
   would take a journal its owner asked to be unlisted and advertise it, which
   is exactly B263's harm arriving through a rename. Absent must keep meaning
   `public`, as it does now (`lib/config.ts`), because every journal written
   before W38 relies on it.
   **Accept `private` as a synonym, for good; never write it.** A one-way
   migration of somebody's `config.json` is not this task's to perform.
2. **`guest` becomes valid at the journal level**, in
   `app/api/v1/journals/route.ts`'s refusal and in
   `JOURNAL_PROFILE_FIELDS`'s patch path (`lib/journals.ts`), and in
   `/openapi.json`'s enum. All three must agree — B263 and B277 both landed
   because one of the three did not.
3. **A new trip inherits the journal's answer.** Today a trip is `private`
   whichever journal it is in, and that default is deliberate — read the
   comment before changing it, and keep the property that a trip is never
   *more* open than it was asked to be. An explicit `visibility` on the
   create call still wins; the journal only supplies the default when the call
   is silent. Note that B267's trip-creation question now has to say what the
   default will be, or an agent cannot tell the owner what silence means.
4. **The journal level still is not access.** `guest` on a journal means
   unlisted and "guest is the norm here"; it does **not** gate reading. A
   `public` trip in a `guest` journal stays readable by anyone with the
   address, exactly as today. Both documents must say that in one line, since
   the whole ticket exists because two levels' words were confusable.

Not in scope: journal-level access (option 3), and the trip's own three
values, which nobody got wrong.
## Acceptance

An owner asked for their journal's visibility can answer correctly the first
time, from the question alone, without being told the difference between
listing and access. And whatever the values become, the documents and the API
refusal agree on them.
