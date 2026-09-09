---
id: B1064
title: A journal's owner is proven by an email alone, and an address costs nothing to make another of
type: FEATURE
priority: high
complexity: high
area: auth, signup, identity
found: "2026-09-09T07:11:54Z"
started: "2026-09-09T17:22:12Z"
merged: "2026-09-09T18:34:33Z"
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

## Decided — 2026-09-09

Answered by the owner, walking the question book:

- **Two independent constraints**, not a constraint on the pair: one journal
  per proven address, one journal per proven number. This is what the brief's
  second clause meant.
- **The number's purpose is reachability first**, with anti-abuse as a side
  effect. That is what keeps it stored in the clear rather than hashed.
- **Same field, proof stamp beside it** — `owner.tel` plus when and how it was
  proven. One number is what a person has; asking for two is a question nobody
  understands. Note in the code that a destination has become an identity.
- **No plus-address or Gmail-dot folding.** The number does the anti-abuse
  work, and some people genuinely use plus-addressing as their address.
- **Deleting a journal frees its address and its number.** The *name* stays
  reserved by the tombstone; the person is not banned. See B1073, which makes
  the held names visible on `/admin`.
- **The number is stored, not hashed**, because the WhatsApp webhook has to
  compare an inbound E.164 against it (B1058) and because `owner.tel` keeps
  its existing job of receiving the owner's own copy of a published day.

## Decided further — 2026-09-09

- **A number change is done by the operator, by hand.** There is no self-serve
  path in the first release: proof is signup-only, so somebody who changes
  their number emails the operator, who edits it. Honest at a scale of one
  real journal, and it becomes support work the moment there are twenty —
  capture that as its own ticket when it does, rather than pre-building it.
  Note that this leaves a real dead end until then: a person whose number
  changes loses their WhatsApp binding and cannot fix it themselves.
- **Two exemptions from needing a proven number**, and no others:
  - **The operator address.** `FERNSCOUT_ADMIN_EMAIL` is one address in the
    environment and owns no journal; requiring a number would make `/admin`
    unreachable after a SIM change.
  - **Test journals** — see B1065 for the mechanism, which is better than an
    exemption.

## Built — 2026-09-09

Validity already established by the plan-a-run gate for group-phone; see
`.claude/runs/2026-09-09-phone-and-gates/brief.json`. Built directly from
this ticket's two "Decided" sections, no re-validation performed.

**The lock is a filesystem lock, not a database table.** The ticket's Work
section says "a table with unique indexes"; what was actually built is
`content/.registry/email/<sha256(email)>.json` and
`content/.registry/tel/<e164>.json`, written with `fs.writeFileSync(...,
{flag: "wx"})` — `O_CREAT|O_EXCL`, atomic at the OS level, the same guarantee
a unique database index gives. Modelled on `lib/tombstones.ts` rather than a
Kysely table for one reason that mattered a lot in practice: `createJournal()`
is called synchronously from ~10 places across the test suite (routes and
`test/*.test.ts`), and a database-backed lock would have forced it `async`,
cascading into every caller. `signup`'s own capability already requires a
database in production (`lib/capabilities.ts`), so nothing in the real
signup path loses anything; the tests that call `createJournal()` directly
keep working unmodified. `lib/registry.ts` carries the full reasoning.

Built: `lib/registry.ts` (`reserve`, `release`, `reconcile`), wired into
`createJournal()` (reserved before `config.json` is written, released on a
write failure) and into `lib/deletions.ts`'s `deleteJournal` (frees both
locks using the owner's email/tel read before the config is removed).
`Owner.tel` in `lib/config.ts` gained `telProvenAt`/`telProvenMethod` beside
it — the "proof stamp" the Decided section asked for. `npm run registry --
reconcile` rebuilds `content/.registry/` from disk; `content/.registry/` is
gitignored alongside `content/.deleted/`.

**Not built: the two exemptions' enforcement.** This ticket is the store;
*requiring* a number for a non-exempt journal is the signup route's job and
is built in B1065, which is where the operator/test exemptions are actually
checked.

Evidence: `test/registry.test.ts` (6 tests) — one email per journal, one
number per journal independent of email, release-then-reclaim, a
same-microtask "concurrent" pair where exactly one wins, a
same-number-different-email conflict caught only by the lock (the disk scan
alone would have let both through), and reconcile rebuilding to the same
state. `test/journals.test.ts`, `test/deletions.test.ts` and six other
existing suites (218 tests total) still pass unmodified — nothing about
`createJournal`'s existing call sites changed.

Pure backend; no page to screenshot.
