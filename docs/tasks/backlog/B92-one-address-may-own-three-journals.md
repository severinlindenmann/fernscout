---
id: B92
title: One address may own three journals, and deleting one does not give the name back to the person who lost it
type: FEATURE
priority: medium
complexity: medium
area: signup, identity
found: "2026-09-03"
---

# B92 — One address may own three journals, and deleting one does not give the name back to the person who lost it

## Why

The ask is two rules: **one journal per email**, and **a person who deletes
their journal may recreate the same one but not a new one**. Neither holds
today, and the second depends on the first.

**Today an address may own three.** `MAX_JOURNALS_PER_EMAIL = 3`
(`lib/journals.ts:74`), checked at `:190–205`. The signup flow already proves
the address (`app/api/auth/signup/verify/route.ts`), and the create route
already spends the token so one code makes one journal
(`app/api/v1/journals/route.ts:167`). So the plumbing for "one per email" is
almost all there — the cap is just set to three. Lowering it to one is a
one-line change and is the smaller half.

**The larger half is what "the same one" means after a delete.** Deletion
writes a tombstone — `content/.deleted/<username>.json`,
`lib/tombstones.ts` — which keeps the name reserved so the next person to claim
`anna` does not inherit a stranger's Christmas-card links. `isReservedUsername`
refuses to hand the name out again. Good, but it refuses *everybody*, including
the person who just deleted it. With a one-journal cap that is a trap: they
deleted their only journal, so the cap now lets them create one — and the only
name they want, their own, is the one name reserved against them.

The tombstone records `requestedBy` (`lib/tombstones.ts:54`) — the owner's
address at deletion. That is exactly the fact needed to tell "the person who
lost this name" apart from "a stranger claiming a name that once belonged to
somebody else." Recreation is: same address, same username, a live tombstone
whose `requestedBy` matches. That combination is not a new journal; it is the
old one coming back.

Two things this must not become:

- **Not un-delete.** The photographs and days are gone (deletion removed them);
  this frees the *name* so the person can start it again, empty. Do not promise
  to restore content — a restore is `lib/deletions.ts` plus a backup, a
  different thing.
- **Not a bypass of the one-per-email cap.** Recreating your deleted journal is
  allowed because you have zero journals now; the tombstone match is what lets
  you reuse the reserved *name*, not a second slot. If they still own a journal,
  the cap refuses regardless of tombstones.

## Work

**Lower the cap to one.** `MAX_JOURNALS_PER_EMAIL` → 1, and reword the refusal
at `lib/journals.ts:194–204` — it currently says "which is the limit on this
server" and lists the journals owned, which for a cap of one reads oddly. It
should point the person at requesting a code for the journal they already own,
which the `next` line at `:201` already does; check it still reads right at one.

**Let the owner reclaim their own reserved name.** In `createJournal`, when the
username is reserved by a tombstone, allow it through only when the tombstone is
a journal tombstone, its `requestedBy` equals this `ownerEmail`, and the address
owns no live journal. Consuming the tombstone on success is the clean end state
— the name is a live journal again, so the reservation has done its job — but
check `lib/tombstones.ts` for whether anything else reads it first (the `410
Gone` path in `proxy.ts` does, and a reclaimed name must stop answering 410 the
moment it is a journal again).

**Say why a name is refused.** A reserved-name refusal to the wrong person and a
reserved-name refusal to the person who owns the tombstone are different
answers. The owner should be told they can recreate it; a stranger should be
told the name is taken and nothing more (the same reasoning as the taken-name
refusal today — do not confirm to a stranger that an address once had a journal
here).

Not doing: restoring deleted content, changing how deletion itself works
(`lib/deletions.ts`), or the operator's manual `rm content/.deleted/anna.json`
escape hatch, which stays as the way an operator frees a name for a genuinely
new person.

Check whether any test or fixture assumes an address can own more than one
journal before lowering the cap — `grep -rn "MAX_JOURNALS" test`.

## Acceptance

- An address that already owns a journal is refused a second, with a message
  that routes it to writing the one it has.
- An owner who deletes their journal can immediately create a new one under the
  **same** username, and it comes up empty.
- After that recreation the old URLs stop answering `410` and the name is a live
  journal.
- A different address is still refused that same username while the tombstone
  stands, and is told only that the name is taken.
- An owner who still holds a live journal cannot use a tombstone to exceed the
  cap of one.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
