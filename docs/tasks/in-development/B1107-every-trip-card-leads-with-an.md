---
id: B1107
title: Every trip card leads with an editable box holding a raw trip id the person has never seen
type: ISSUE
priority: medium
complexity: low
area: lib/helper/tools/areas, components/HelperAsk.tsx
found: "2026-09-09T16:46:47Z"
started: "2026-09-09T17:49:39Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-09T17:49:39Z"
---

# B1107 — Every trip card leads with an editable box holding a raw trip id the person has never seen

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`lib/helper/model.ts`'s prompt says it outright:

> Never ask them for an id — not a trip id, not a day slug, not a file id.
> **None of those are on their screen.**

They are now. Every card from B1078's trip tools opens with a field labelled
"Trip" whose value is `iceland-2026` — the folder name. Seen on the live site
on 2026-09-09, on `set_visibility` and `trip_people` both, as the **first**
field, above "Who may read it" and above "Their name".

Three things are wrong with it at once:

- It is the one field on the card a person cannot have an opinion about. The
  trip was already resolved by the server before the card was drawn; showing
  it invites correction of the only value that must not be corrected.
- It is editable. Typing a different slug into it presses against a different
  trip, and the route will accept any trip the owner owns. The card says
  "Islandreise" in its sentence and `iceland-2026` in its field, so the person
  has two names for one thing and no reason to think they differ.
- It reads as a mistake. A person who has never seen a slug sees machinery.

## Work

Do not draw a field whose value the server resolved and the person cannot
usefully change. The `trip` argument still has to travel with the press — it
*is* the press (B900) — so this is about what `HelperAsk` renders, not about
what the proposal carries.

The likely shape: a proposal field gains something like `fixed: true`, and the
renderer shows it as plain text beside the sentence, or not at all. Check
whether `day`/`slug` fields have the same problem before choosing — a fix that
only covers `trip` will be back within the month.

Not doing: removing the argument, or resolving the trip in the browser.

## Acceptance

Ask the conversation to change who may read a trip. The card shows the trip by
the name you call it, and there is no editable box containing a slug.
