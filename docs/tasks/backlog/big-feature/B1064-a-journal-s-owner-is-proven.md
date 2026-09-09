---
id: B1064
title: A journal's owner is proven by an email alone, and an address costs nothing to make another of
type: FEATURE
priority: high
complexity: high
area: auth, signup, identity
found: "2026-09-09T07:11:54Z"
---

# B1064 — A journal's owner is proven by an email alone, and an address costs nothing to make another of

## Why

Ownership of a journal is one field in one file: `owner.email` in
`content/<username>/config.json`. The cap is enforced in exactly one place —
`createJournal()` in `lib/journals.ts:194` asks `journalsOwnedBy(email)`
(`:126`), which **reads every `content/*/config.json` off disk** and compares
the address case-folded, against `MAX_JOURNALS_PER_EMAIL = 1` (`:111`).

Three things follow, and the third is the reason for this ticket.

- **It is a scan, not a constraint.** Two concurrent creates for one address
  with different usernames both pass the check before either directory exists.
  Unlikely, unbounded, and unrecoverable once it happens.
- **It scales with the number of journals**, on every signup.
- **An address costs nothing to make another of.** `normaliseEmail`
  (`lib/auth/index.ts:313`) is `trim().toLowerCase()` and nothing else — no
  plus-address folding, no Gmail dot-folding — so `me+1@gmail.com` and
  `me+2@gmail.com` are two owners of two journals today. The cap is a guard
  against accident, and it is honest about being nothing more.

The owner's proposal is that a journal require **a proven telephone number as
well as a proven address**, and that a pair map to exactly one journal. Stated
as a pair it is ambiguous, and the ambiguity matters: *"also not the same
phone with another email"* means the constraint is not on the pair at all. It
is two independent uniqueness rules — **one journal per address, and one
journal per number** — and writing it that way is what makes it implementable
and explainable.

Whether that is worth building depends on a question the code cannot answer:
**what is the number for?** Anti-abuse, account recovery, or the WhatsApp
channel's identity? Each implies a different design and two of them are
cheaper. The question book carries it; nothing here should start before it is
answered.

## Work

Assuming the answer is "all three", the shape:

- **A registry with real constraints.** A table with unique indexes on the
  normalised address and the normalised E.164 number, rather than a directory
  scan. Disk stays the truth (`config.json` is still where ownership is
  written, and a journal exported and restored must still work) — so the table
  is a lock rebuildable from disk, and a `reconcile` command that rebuilds it
  is part of the ticket, not a follow-up.
- **A number is proven or it does not count.** Store when and how. An unproven
  number in `owner.tel` today means "send my own copy here" and must not
  quietly start meaning "this is who I am" — decide whether that is the same
  field with a proof stamp beside it, or a second field, and say why.
- **Normalisation, decided once and written down.** `toE164`
  (`lib/whatsapp/phone.ts`) for numbers. For addresses, decide explicitly
  whether plus-addressing and Gmail dots are folded. Today they are not; if
  the number is doing the anti-abuse work, they need not be, and that is the
  cheaper answer.
- Tombstones (`content/.deleted/`) already hold a deleted journal's name.
  Decide whether they hold its address and number too, or whether deleting
  frees them.

Not doing: proving the number (B1065), or what happens to journals that
already exist (B1066).

## Acceptance

Two journals cannot be created for one address or one number, proved by a test
that runs both creates concurrently; and the registry can be thrown away and
rebuilt from `content/` with the same result.
