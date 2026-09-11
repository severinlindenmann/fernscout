---
id: B1073
title: Nothing shows the operator which journal names are held in reserve
type: FEATURE
priority: low
complexity: low
area: admin, tombstones
found: "2026-09-09T10:49:16Z"
started: "2026-09-11T16:26:44Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T16:26:44Z"
---

# B1073 — Nothing shows the operator which journal names are held in reserve

## Why

`content/.deleted/<username>.json` keeps a deleted journal's name reserved so
its old URLs answer 410 rather than becoming somebody else's pages
(`lib/tombstones.ts`). An operator frees a name by deleting the file — which
means knowing the file is there, over SSH, in a directory nothing lists.

`/admin` (B746) is the page that exists to tell the operator what their
instance is doing, and it does not mention this. So the reserved-name list is
real state with real consequences — a signup refused with `username_taken`
for a journal nobody can see — and the only way to read it is a shell.

It matters slightly more from 2026-09-09, since the decision on B1064 is that
deleting a journal **frees its owner's address and telephone number** while
the *name* stays held. Two halves that behave differently need somewhere a
person can see which is which.

## Work

- A section on `/admin` listing tombstoned names: the name, when it was
  deleted, and nothing else. It is a name and a date, not a person.
- Whether the page can free one is a decision. Reading it is the whole of the
  problem today; a button that permanently un-reserves URLs is a second,
  larger question and can be a follow-up.
- `/admin` reads a cookie and asks `resolveIdentity`, never a bearer token —
  the existing gate, unchanged.

Not doing: exposing this anywhere but `/admin`, or making tombstones expire.

## Acceptance

The operator can see every held name and its date without opening a shell.


## Decision, 2026-09-11 — it belongs on /admin

Asked and answered: the reserved names go on **`/admin`**.

That is the right home for it and it settles the ticket's own open question.
`/admin` is already the one page on this instance that is about the *instance*
rather than a journal — what a month costs, every journal's balance, the ledger
— read from an `fs_identity` cookie against `FERNSCOUT_ADMIN_EMAIL`, and a 404
for everybody else. A held name is exactly that kind of fact: it belongs to the
server, not to any journal, and only the operator can act on it.

So: list what `content/.deleted/` holds, and say for each how a name is freed —
AGENTS.md is explicit that freeing one is `rm content/.deleted/<user>.json`, *"a
thing an operator does"*.

Note the two shapes while building: `.deleted/<user>.json` is a whole journal,
`.deleted/<user>/<trip>.json` is one trip of a journal that still exists. The
live instance currently holds one of the second kind and none of the first,
which is the case most likely to be got wrong — I misread that listing myself
today.

## Built, 2026-09-11

Most of the journal half already existed: B1354 (merged the same day) put
`allTombstones()`, a Roster section and a Release button on `/admin` — but
`allTombstones()` only ever read `.deleted/*.json`, one level deep, so a whole
journal's tombstone was the only shape it could see. A trip's tombstone, one
level further down at `.deleted/<user>/<trip>.json`, was invisible to the page
entirely — the exact gap this ticket is about.

- `lib/adminConsole.ts`'s `allTombstones()` now also walks each username
  subdirectory of `.deleted/` and reads the trip tombstones inside it, so
  both shapes come back in one list, distinguished by `kind`.
- `Roster` in `app/admin/page.tsx` now renders two separate sections rather
  than one: "Whole journals deleted — the name is held" (unchanged from
  B1354, with Release) and "One trip deleted — the journal is still here"
  (new, read-only). Each section's own paragraph says what it does and does
  not do — a held name blocks signup and a 410; a trip's tombstone only keeps
  that trip's old links answering "gone" and holds no name back at all.
- Freeing a trip's tombstone is left undone, as the ticket allowed: there is
  no route for it, and the section says the manual `rm` in words rather than
  offering a button that does not exist.
- No new UI strings needed translating: `/admin` has no `t()` calls anywhere
  and is English-only throughout (confirmed by grep before writing anything).
- Reading cost: one `readdirSync` of `.deleted/` (as before) plus one more per
  username subdirectory found in it — the same shape and the same cheap read
  B996 already relied on for the journal-only count, on a directory that holds
  a handful of entries even on a busy instance. No caching was added because
  none existed before.
- New test: `test/admin-tombstones.test.ts`, asserting `allTombstones()`
  returns both a journal and a trip tombstone with the right `kind` and
  `tripId`, from two files at the two real paths.

`npm run verify`: 527 files / 6916 passed | 4 skipped (baseline 525/6906), plus
`npm run unused` clean. Committed on `b1073-admin-names`, not merged.
