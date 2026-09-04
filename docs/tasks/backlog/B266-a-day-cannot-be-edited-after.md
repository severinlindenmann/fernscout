---
id: B266
title: A day cannot be edited after it is written, and the agent that tried published fifteen of them
type: ISSUE
priority: high
complexity: medium
area: api, entries, agent docs
found: "2026-09-04T11:35:51Z"
---

# B266 — A day cannot be edited after it is written, and the agent that tried published fifteen of them

## Why

Observed 2026-09-04 on fernscout.ch. An agent wrote fifteen draft days into
`viki/asia-2025`, was then asked to add photographs and coordinates, and
reported:

> Coordinates added to all 15 days … All entries are currently drafts — they
> won't appear on your public journal until you review and publish them.

Both halves are false, and the second is the serious one.

**On disk:** no entry has a `lat:` or `lng:` line, and no entry has a
`status:` line at all. Publishing works by *removing* `status: draft`
(`lib/api/entries.ts:492-497`), so all fifteen days are **published**.

**The timeline is conclusive.** Every entry file has an mtime inside one
second — `13:32:56.877` to `13:32:57.301`, in slug order — five minutes after
the directory was last written at `13:27:44`. The *directory* mtime is
unchanged, so nothing was created or deleted in that sweep: fifteen existing
files were modified in place. The only in-place writer that removes the draft
line is `publishDraft`.

**Why it reached for publish.** There is no way to edit a day.
`app/api/v1/[user]/trips/[trip]/days/[slug]/route.ts` exports `GET` and
nothing else — no `PATCH`, no `PUT`. The only write verbs an existing day has
are `.../publish` and `DELETE`. So an agent asked to add a coordinate to a day
it already wrote has no correct call available, and the endpoint whose name is
closest to "commit my change" is the one that publishes it.

This is the exact harm the design is built to prevent. AGENTS.md: *"writing and
publishing are two calls so there is a moment in between."* The moment existed
and an editing gap spent it — on fifteen days, unreviewed, while telling their
owner they were still drafts.

The reporting failure compounds it but is not the cause: `publishDraft`
returns a receipt saying what became readable (`publishNotice`), so the truth
was in the response and the agent narrated its intention instead. Same shape
as B263.

## Work

Two things, and the first is not optional even though it is the smaller.

1. **Say that a day cannot be edited**, in `/agent.md` and
   `/documentation.txt`, next to the day-creation call: the only ways to change
   a day that exists are `DELETE` and write it again, and `publish` is not an
   update. Name this failure — an agent reached for publish because it was the
   only write verb — the way the guide already names `alex-2` and `asia-2025`.
   This alone closes the trap.
2. **An editing endpoint.** `PATCH .../days/<slug>` taking the same fields as
   creation, refusing to change `status` by any route, and leaving a published
   day published and a draft a draft. `createDraft` already assembles this
   frontmatter and `appendGallery` already splices into an existing file
   textually without touching the rest, so the pieces exist.

   **A published day may be edited** — decided by the owner on 2026-09-04, so
   this is settled and not yours to reopen. A journal is somebody's account of
   what happened and a correction to it is the ordinary case, not the exception:
   a wrong date, a misspelled place, a coordinate that was missing. Refusing to
   touch a published day would mean the only way to fix a typo is to unpublish,
   rewrite and republish, and an agent with no unpublish call would do what the
   one in the Why did — reach for the nearest verb and get it wrong.

   What must not change is *which state the day is in*. Editing a published day
   leaves it published; editing a draft leaves it a draft; neither is a way to
   publish or unpublish. Say in the response which state the day was left in,
   so an agent reporting to its owner has the truth to hand rather than its own
   intention — that is the half B263 and the Why above both turn on.

Note in passing, do not fix here: coordinates for an existing day are the
thing that was actually wanted, and B267 is why the agent had none to write in
the first place.

## Acceptance

- Both documents state that `publish` is not an update and say what to do
  instead.
- `PATCH .../days/<slug>` changes a field on a draft and the day is still a
  draft afterwards; the same on a published day leaves it published.
- No request to any endpoint can move a day between draft and published except
  `.../publish`, asserted by a test.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
