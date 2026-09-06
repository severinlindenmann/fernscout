---
id: B578
title: Editing a day's title on disk makes publish unable to find that day again
type: ISSUE
priority: medium
complexity: low
area: fernscout-helper, publish, days
found: "2026-09-06T14:02:08Z"
started: "2026-09-06T14:07:42Z"
session: ac8af30e-815d-4843-a94d-cf061a70269c
claimed: "2026-09-06T14:07:42Z"
---

# B578 — Editing a day's title on disk makes publish unable to find that day again

## Why

Noticed on 2026-09-06 by an agent working on B574, and confirmed against the
published contract rather than by running it.

`publish.mjs` finds the day the instance already has by date and title:

    const already = new Map(
      (listed.body?.days ?? []).map((d) => [`${d.date}|${d.title}`, d]),
    );
    ...
    const existing = already.get(`${date}|${entry.data.title}`);

The comment above it explains why, and the reasoning is sound: the slug is the
server's to choose and is made from the title, so a filename cannot be used to
address a day. Matching on what identifies a day to a reader is the right
instinct.

But the title is *part of what a person edits*. Change `title:` in an entry
file — fix a typo, reword it — and the map lookup misses. The day is then
treated as new, and publish posts it with

    idempotency_key: `${trip.id}:${entry.slug}`

which is derived from the filename and therefore unchanged. The instance's own
description of that key: *"send it with a different body and the call is
refused (409) and nothing is written."* So the likely outcome is not a
duplicate day — it is `refuse()` stopping the entire run on a 409 whose message
is about idempotency, for what the person experiences as "I fixed a typo".

If the key has aged out server-side, the other branch is worse: a second day
appears, same date, old title and new title side by side, and the original
keeps the photographs.

Either way the failure is silent about its cause. Nothing in `SKILL.md` or
`AGENTS.md` warns that a day's title is effectively immutable once published.

**Not verified by running it.** Doing so against the only available instance
means either a stuck run or a stray day on somebody's real published journal,
and the second is not cleanly reversible without a DELETE. The reasoning above
is from `publish.mjs` and the `idempotency_key` description in
`<site>/openapi.json`; the first job below is to find out which branch actually
happens.

Related: B572 is the same shape one level up — a `trip.md` edit that never
reaches the site. This is a day edit that reaches it as the wrong kind of write.

## Work

- First, establish the real behaviour against a throwaway trip on a test
  instance: retitle a published day, run publish, record whether it 409s or
  duplicates. Write the answer into this task before building anything.
- Then match days by something the person does not edit. The day's own slug is
  the server's answer and is stable once created; recording the slug the
  instance returned — in the entry's frontmatter, the way `id:` works for a
  trip — would make the match exact and survive both a retitle and a rename.
  That is a file-format change, so it needs saying in `model.mjs` and
  `AGENTS.md`.
- Failing that, fall back to matching on date alone when the title misses and
  exactly one day shares that date, and say in the output that it matched
  loosely.
- Whatever the fix, a 409 from the idempotency key must be reported as what it
  means — *this day exists under a different title* — not as a raw refusal.

Not doing: changing how the server derives slugs.

## Acceptance

- Retitling a published day and re-publishing updates that day, leaves its
  photographs attached, and creates no second day — demonstrated against a
  test instance with the before and after listing.
- The run says which day it matched and how, when the match was not exact.
- A genuinely new day on a date that already has one is still created.
