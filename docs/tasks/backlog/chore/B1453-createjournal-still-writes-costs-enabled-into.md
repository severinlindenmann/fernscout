---
id: B1453
title: createJournal still writes costs: enabled into every new journal's config, where nothing reads it
type: CHORE
priority: low
complexity: low
area: journals, config
found: "2026-09-11T12:08:31Z"
---

# B1453 — createJournal still writes costs: enabled into every new journal's config, where nothing reads it

## Why

Found while building B1092, which made `costs` operator-only.

`createJournal` (`lib/journals.ts:389`) still writes `costs: { enabled: true }`
into every new journal's `config.json`. Since B1092 that key is **dead data**:
`resolveOne` skips every name in `OPERATOR_ONLY_FEATURES`, so a journal's own
`features.costs` is never read by anything.

It is harmless and it is misleading, which is the whole of the case for fixing
it. An owner who opens their own `config.json` — and they can, it is their
folder, which is the point of this product — reads a line saying costs are
enabled for their journal, and it neither is nor is not true: the instance
decides. `photobook` and `postcards` are not written there, for exactly this
reason, so this is an inconsistency rather than a convention.

## Work

Stop writing `costs` in `createJournal`, the same way `photobook` and
`postcards` are already left out.

Decide separately, and say which you did: whether existing journals' config
files get the dead key removed. Leaving it is defensible — nothing reads it, and
rewriting somebody's own file to delete a line is a bigger act than it looks.
Not doing it means the inconsistency survives for every journal created before
this change.

## Acceptance

- A journal created after this change has no `costs` key in its `features` block.
- `npm run verify` clean, including `test/server-only-capabilities.test.ts`.
