---
id: B1453
title: createJournal still writes costs: enabled into every new journal's config, where nothing reads it
type: CHORE
priority: low
complexity: low
area: journals, config
found: "2026-09-11T12:08:31Z"
merged: "2026-09-14T06:09:08Z"
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

## Resolution (2026-09-14)

Confirmed against `lib/config.ts:87`: `costs` is in `OPERATOR_ONLY_FEATURES`
(joined in B1092, ticket premise unchanged). `createJournal`
(`lib/journals.ts`) no longer writes `costs: { enabled: true }` — dropped the
same way `photobook` and `postcards` already are, with a comment explaining
why. `DEFAULT_FEATURES` in `lib/config.ts` still answers
`costs: { enabled: true }` for any journal missing the key (as it always did
for `photobook`/`postcards`), so nothing about the resolved capability
changes — only the file an owner reads.

Decision on existing journals: **left alone.** Not rewriting every prior
journal's `config.json` to strip a harmless, unread key — that is the larger
act the ticket itself calls out, and it does not need a deploy-time migration
to be safe. New journals are clean; old ones keep the inert line until
something else already touches their file.

Added `test/journals.test.ts` — "a journal it creates carries no costs key —
it is operator-only" — asserting the raw config.json has no `costs` property.
Fails without the fix (verified by reverting `lib/journals.ts`), passes with
it. `test/server-only-capabilities.test.ts` unaffected (12 passed).
