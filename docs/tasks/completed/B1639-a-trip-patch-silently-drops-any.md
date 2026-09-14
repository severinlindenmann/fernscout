---
id: B1639
title: "A trip PATCH silently drops any key the model does not carry, where v1 surfaced them as unknownFields"
type: ISSUE
priority: medium
complexity: low
area: API v2
found: 2026-09-13T00:00:00Z
merged: "2026-09-14T04:54:32Z"
completed: "2026-09-14T16:32:23Z"
---

## Why

Every v2 patcher is now read-modify-write through `tripFromJson`/`tripToJson`
(and the day equivalents). Those build a fresh object from the fields the
model knows, so **any key the model does not carry is gone after the next
edit** — not refused, not reported, just absent.

For the serializer this is deliberate and documented: v2-canonical, no
unknown-key preservation, because the replay rewrites everything. The part
nobody decided is that the **patch routes inherit it**. v1 did the opposite
and did it on purpose: `Trip.unknownFields` (`lib/trips.ts`) existed so a
reader could be *told* about a key the software did not recognise, rather
than the file quietly losing it.

So the behaviour changed from "keep it and say so" to "drop it and say
nothing", as a side effect of how the writers were rebuilt.

How much it matters depends on something not yet decided: whether anybody
ever hand-edits a file. After the replay all content is v2-canonical and
there is nothing unmodelled to lose — but "the content is a folder the author
owns" is the first sentence of `AGENTS.md`, and an owner who adds a key and
then edits that trip through the web loses it without being told.

Found while repointing `app/api/trip/route.ts`'s tests (B1630).

## Work

Decide which promise this codebase is making, then make it true:

- **If the folder is the owner's to edit** — preserve unknown keys through
  read-modify-write, and keep surfacing them the way `unknownFields` did.
  Costs a passthrough field on the document type.
- **If v2-canonical means exactly what it says** — refuse a file carrying a
  key the model does not know, loudly, at read time, rather than dropping it
  at write time. Silence is the part that is wrong, not the strictness.

Not doing: leaving it as "drops it and says nothing", which is the one option
neither promise supports.

## Acceptance

- A trip.json carrying an unmodelled key, edited through the API, either
  keeps that key or is refused with a message naming it.
- A test writes such a file, patches it, and asserts which.
- Whichever is chosen, `AGENTS.md`'s sentence about the folder being the
  author's still reads true afterwards.
