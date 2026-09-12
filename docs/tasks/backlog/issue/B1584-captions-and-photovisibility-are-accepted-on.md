---
id: B1584
title: captions and photoVisibility are accepted on a day and appear in no published contract as keys
type: ISSUE
priority: medium
complexity: low
area: lib/contentModel, contract
found: "2026-09-12T12:42:00Z"
---

# B1584 — captions and photoVisibility are accepted on a day and appear in no published contract as keys

## Why

Found by B1577's gate on its first run, which is the gate working.

`EDITABLE_DAY_FIELDS` (`lib/api/entries.ts:980`) includes `captions` and
`photoVisibility`, so `PATCH .../days/{slug}` accepts both — `captions` a map
of caption keyed by a gallery item's `src` (B522, the one part of a `gallery:`
block a PATCH may change), and `photoVisibility` the per-photograph label
(B596). Neither appears in `content-model.json` as a key of a day, in any
form: not in the `known-key` list, not as `never-in-file`.

So the document's own account of what a day's write may carry was two fields
short, and a client reading it to build a `PATCH` could not learn that either
exists. Same family as the rest of this run — the code accepts a field the
published contract does not describe — except here the contract is *silent*
rather than wrong, which is the harder kind to notice.

Both are genuinely api-only: in the file a caption is `gallery[].caption` and a
label is `gallery[].visibility`, so the flat top-level spellings exist only on
the wire. `never-in-file` is the right declaration, the same as `coordinates`
and `photos` two lines above where they belong.

## Work

Two `apiOnly: true` entries in the day's key block in
`lib/contentModel/document.ts`, each with the `because` that says where the
file keeps the same fact.

**Fixed inside B1577** rather than left, because that ticket's gate fails
until the document and `EDITABLE_DAY_FIELDS` agree, and carving an exemption
for a real gap would have made the gate lie on its first day. Captured
separately so the gap is recorded as its own fact.

## Acceptance

- `content-model.json` lists `captions` and `photoVisibility` as keys of a day
  that never appear in a file.
- `test/content-model.test.ts` still agrees with `lib/validate/*` over the
  fixtures.
