---
id: B1733
title: owner.email is patchable with an owner token and no proof of the new address, and it is the address that mints owner tokens
type: SECURITY
priority: medium
complexity: medium
area: auth, journal document
found: "2026-09-14T12:03:19Z"
started: "2026-09-14T13:14:48Z"
session: 3309c078-d934-4ee7-ad04-6cd719fc543a
claimed: "2026-09-14T13:14:48Z"
---

# B1733 — owner.email is patchable with an owner token and no proof of the new address, and it is the address that mints owner tokens

## Why

Raised by an audit of `config.json` round-tripping, which asked the question
rather than assuming the answer: **should changing the address that can mint
tokens require proving it first, the way `tel` does?**

What is true today, confirmed in the code rather than inferred:

- `owner.email` is in `journalPatch`'s writable properties
  (`/api/v2/openapi.json`), so an owner token can change it, with nothing sent
  to the new address.
- That field is what ownership *is*. `lib/api/auth.ts:119` resolves an owner by
  comparing the session's address against `getUser(username)?.owner.email`, and
  `agentScope` refuses a journal-wide write code for any other address —
  verified live: `[auth] write token refused for severin: a write code with no
  trip on it, for an address that is not the owner`.
- `owner.tel` is the opposite by design: it cannot be patched at all, and is
  set only by a verification round trip (`lib/ownerTel.ts`).

So the weaker field is the one that grants everything. A stolen seven-day agent
token is a seven-day problem; a stolen token plus one `PATCH` is permanent,
because the attacker's address can then mint fresh owner tokens for as long as
the journal exists, and the real owner's cannot.

**Not an escalation** — it takes an owner token to start with, and the audit
was explicit that the defences it probed (the `{name, nickname, email}`
sub-schema with `additionalProperties: false`, the refusal of `tel`,
`telProvenAt` and `telProvenMethod` on the wire) are sound and must not be
touched. This is about what one legitimate field means.

## Work

A decision for the owner, not for an agent. Two shapes, both coherent:

1. **Prove it, like `tel`.** `PATCH` with a new `owner.email` starts a
   verification instead of writing: a code goes to the new address, and the
   change lands when it comes back. Costs a round trip on a rare operation and
   makes the ownership record as strong as the telephone record.
2. **Leave it writable and say so.** Document that an owner token can move
   ownership, and treat token theft as the whole of the threat. Cheaper, and
   honest only if written down where somebody minting a token will read it.

Whichever is chosen, the other half is worth doing either way: **say in the
answer what changed.** A `PATCH` that moves `owner.email` should mail the old
address, the way a deletion does — a change nobody can undo should not be
silent to the person it takes the journal from.

## Acceptance

- Either a new address is proven before it becomes the owner, or the contract
  says plainly that an owner token can hand the journal to another address.
- The old address learns that it happened.

## Done, 2026-09-14

Built option 1 — "prove it, like `tel`" — per the owner's decision recorded in
the run that took this ticket.

**A correction to this ticket's own evidence, found while revalidating
before touching anything.** By the time this build started, `owner.email`
was NOT actually patchable at all: `JOURNAL_IMMUTABLE_FIELDS` in
`lib/api/v2/write.ts` already refused any CHANGED `owner.email` outright
(400 "owner.email is not writable"), covered by an existing test
(`test/api-v2-journal.test.ts`, "a CHANGED owner.email is refused"). The
Zod-level claim in this ticket's "Why" is still true — `owner.email` is a
genuine field of `journalPatch` (`base.partial()`), so it survives the
schema — but the shared write path in front of the schema already caught
every change before it landed. So the live exploit this ticket opened with
was already closed; what remained open was the ticket's real question:
should a legitimate owner-to-owner handoff require proof, the way `tel`
does, rather than being simply impossible? Built accordingly.

**The flow.**

```
PATCH /api/v2/{user}  {"owner": {"email": "new@…"}}
  -> 202 {"pending": "owner_email", "id": "…",
          "next": "POST /api/v2/{user}/owner/email/redeem"}
     (a six-digit code, 30 minutes, five attempts, goes to new@… ;
      nothing written yet)

POST /api/v2/{user}/owner/email/redeem  {"id": "…", "code": "…"}
  -> 200, the journal document, owner.email now moved
     - every session and agent token the OLD address held for THIS
       journal is revoked, immediately, whatever its own expiry said
     - the OLD address is mailed that the journal moved
```

An UNCHANGED `owner.email` (the ordinary GET/edit/PATCH-the-whole-document
round trip a mirroring client does on every save) is silently accepted, as
before — `stripEchoedFields` still drops it. A CHANGED but syntactically
invalid address (not `isEmail`) still takes the old 400 refusal unchanged,
since there is nothing to verify about a string that was never going to be
a real address. Only a CHANGED, valid address takes the new door.

**Where it lives.**

- `lib/ownerEmailChange.ts` — `issueOwnerEmailCode`/`checkOwnerEmailChange`,
  modelled on `lib/phoneVerify/codes.ts`: a THIRD reuse of the `login_codes`
  table with its own `kind` (`"owner_email"`, journal-scoped by `owner_id`,
  unlike the phone kind's `NO_JOURNAL`), rather than a new table — the same
  OTP discipline (hash only, 30 min, 5 attempts, superseded on reissue) one
  more place gets to inherit rather than reimplement. No new migration.
- `app/api/v2/[user]/route.ts` — `PATCH` intercepts a CHANGED, valid
  `owner.email` BEFORE `stripEchoedFields` ever refuses it, and answers 202
  instead of writing (`startOwnerEmailVerification`).
- `app/api/v2/[user]/owner/email/redeem/route.ts` — new. The only writer of
  `owner.email` on success (`lib/journals.ts`'s new `setOwnerEmail`, mirroring
  `setJournalV2Fields`'s edit-in-place discipline).
- `lib/auth/index.ts` — new `revokeSessionsForAddress(owner, email)`, scoped
  by this journal's `owner_id` AND the address's own `users` row, so it
  never touches a session the same address holds on a different journal or
  an identity session (which proves the address, not access to anything).
  The redeem route also calls the existing `revokeCodes` for any live,
  not-yet-redeemed `agent`/`guest` codes under the old address.
- `lib/api/v2/schemas/ownerEmail.ts` — `ownerEmailPending`, `ownerEmailRedeem`.
- `lib/api/v2/openapi.ts` — the PATCH operation documents its new 202
  alongside 200; the redeem door is a new path. No new error codes: every
  refusal reuses `mail_disabled`, `mail_failed`, `invalid_code`,
  `too_many_requests`, all already in `lib/api/errorCodes.ts` and already
  spoken by other routes.
- `site/locales/{en,de,hu}.json` — 9 real keys (`mail.ownerEmailCode*`,
  `mail.ownerEmailMoved*`) for the two new mails; `npm run i18n:keys` run.
- Untouched, exactly as the ticket said to leave them: the owner sub-schema,
  the wire refusal of `tel`/`telProvenAt`/`telProvenMethod`, a forged
  phone-proof in `config.json`.

**Tests.** `test/owner-email-change.test.ts` (new): unchanged echo starts
nothing and sends no mail; a malformed changed address still gets the old
400; a valid changed address gets 202 and writes nothing; a wrong code at
redeem changes nothing and the old token stays live; a stale/replayed id
cannot be redeemed twice; the right code writes the address, the OLD
token goes dead on its very next call, the NEW address can mint its own
owner token, and the old address is mailed. `test/api-v2-journal.test.ts`'s
old "a CHANGED owner.email is refused" test was split in two — malformed
(still 400) and valid (now 202) — since its premise changed under this
ticket, per this ticket's own contract.

**Verify.** `VERIFY_WILL_WAIT=1 npm run verify` — build, TypeScript, ESLint,
7737 Vitest tests passed (4 pre-existing Postgres skips, no local
`pg_dump`), knip — all green.

Not moved to `testing/` and not merged — the security review path runs on
the branch first, per `AGENTS.md`.
