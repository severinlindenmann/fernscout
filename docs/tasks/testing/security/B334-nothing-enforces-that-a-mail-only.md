---
id: B334
title: Nothing enforces that a mail only ever goes to a confirmed address; five senders each happen to be right
type: SECURITY
priority: medium
complexity: medium
area: mail, contacts, consent
found: "2026-09-04T21:25:11Z"
related: B315
started: "2026-09-07T11:40:28Z"
merged: "2026-09-07T12:12:21Z"
---

# B334 — Nothing enforces that a mail only ever goes to a confirmed address; five senders each happen to be right

## Why

Asked for by the owner on 2026-09-04, while deciding B315: *"we never send a
user a mail if he is not verified and had not did the passcode verification
(except direct mail invites)."*

**The rule already holds, and that is the problem.** It holds because every
sender is individually correct, not because anything makes it hold:

| Sender | Why it is currently safe |
| --- | --- |
| `sendCodeMail` | the passcode itself — an unverified address is the whole point |
| `sendInviteMail` | the owner directly inviting somebody; the owner's own decision, and the stated exception |
| `sendConfirmedMail` | sent at confirmation, so the address is proven by then |
| `sendApprovedMail` | approval requires `confirmedAt` (`lib/contacts/index.ts:684`) |
| `notifyOwnerOfRequest` | goes to the owner, never to the contact |
| the digest | `lib/digest/index.ts:197` requires `status === "active"`, unreachable without `confirmedAt` |

Six paths, six separate arguments, and not one line of code that would stop a
seventh from being wrong. The column exists — `contacts.confirmed_at`
(`lib/db/schema.ts:144`) — and every guard above reaches it by a different
route: one asks `status`, one asks `confirmedAt` directly, three rely on where
they are called from, and one is safe only because of who the recipient is.

The failure this invites is quiet and expensive. Somebody adds a "your
photobook is ready" mail, or a push-to-mail fallback, or a per-day
notification, follows the pattern of whichever sender they read first, and
mails an address that never proved it wanted anything. There is no test that
fails, no reviewer prompt, and the person who finds out is the recipient — or
their spam filter, which takes the whole instance's deliverability with it.

The digest is also the only sender whose recipient rule is *stated* anywhere.
The rest is folklore.

Filed SECURITY rather than CHORE because what it guards is somebody else's
inbox and this instance's ability to deliver mail at all, and because the
absent enforcement is the finding — not any current bug. **Nothing here is
known to be broken today**, which is exactly why it is worth doing before it
is.

## Work

Put the rule in one place and make every sender pass through it.

The shape that does the job: a single check the mail layer applies to any
message addressed to a **contact**, refusing to send when that contact has no
`confirmed_at` — and an explicit, named opt-out for the mails whose whole
purpose is to reach an unproven address.

Three things to get right:

- **The exceptions must be named at the call site, not inferred.** A boolean
  like `allowUnconfirmed: true` on `sendCodeMail` and `sendInviteMail` is
  readable and greppable; a rule that quietly exempts "transactional" mail is
  the same folklore in a different jumper. Two exceptions is the whole list
  today, and a third should have to be argued for.
- **Owner mail is a different question, not an exception to this one.** The
  welcome mail (`lib/journals.ts`), the deletion link (`lib/deletions.ts`) and
  the signup code go to an address in `config.json` or to somebody proving a
  new journal — there is no contact row to check. Decide whether they route
  through the same door with a distinct reason, or stay outside it; either is
  fine, but say which and why, because "the checker did not apply here" is how
  the next gap opens.
- **Refuse loudly, and never silently drop.** A refused send should be a
  logged skip with a reason, the way `DigestSkipped` already records
  `not-approved` — not a swallowed exception. `lib/mail` returning null when
  mail is off is the precedent for how this goes wrong (B160): a quiet null
  took the success path and burned a live code.

Consider whether the same door should also assert *consent* for anything
bulk — `wantsEmailDigest` — so that "confirmed" and "asked for this" are two
checks in one place rather than one here and one in the digest. Probably yes,
and it is the same argument.

Not doing: any change to what is sent today, or to the four states. This is
enforcement of a rule that already holds, plus the test that says so.

## Acceptance

- One function decides whether a contact may be mailed, and every contact-
  addressed send calls it.
- `sendCodeMail` and `sendInviteMail` are the only callers that opt out, and
  they say so in an argument a reader can grep for.
- A test adds a sender that mails an unconfirmed contact without opting out,
  and it is refused — the test fails if the check is removed.
- A refusal is logged with the contact and the reason, and is never a silent
  no-op.
- `npm run verify`.

## Found and fixed (2026-09-07)

Confirmed the six senders in the Why table still exist under those names (in
`lib/contacts/mail.ts`, plus the digest's own loop in
`lib/digest/dayLetter.ts`), each still correct today for the reason stated,
and none of them sharing a gate.

Added `mayMailContact(contact, { allowUnconfirmed? })` in
`lib/contacts/mail.ts` — `true` when `contact.confirmedAt` is set or the
caller names the exception, `false` (with a `console.warn` naming the address
and the reason) otherwise. Wired in:

- `sendCodeMail` — calls it with `{ allowUnconfirmed: true }` (the passcode
  itself; there is nothing yet to have confirmed).
- `sendInviteMail` — calls it with `{ allowUnconfirmed: true }` (the owner
  directly handing somebody a link).
- `sendConfirmedMail` — calls it plainly; returns `null` if refused.
- `sendApprovedMail` — calls it plainly; returns `null` if refused.
- `notifyOwnerOfRequest` — does **not** call it. Left a comment saying why:
  the recipient is `config.json`'s `owner.email`, never `contact.email`, so
  there is no `confirmed_at` on the actual recipient to be asking about. A
  different question, not an exception — per the ticket's own instruction.
- The digest's recipient loop (`recipientsFor` in `lib/digest/dayLetter.ts`,
  called from `sendDayLetter`) — added a `mayMailContact(contact)` check
  alongside the existing `status !== "active"` / `wantsEmailDigest` filters,
  so the fact "unreachable without `confirmed_at`" is enforced rather than
  merely true today.

Owner mail elsewhere (`lib/journals.ts`'s welcome mail, `lib/deletions.ts`'s
deletion link, the signup code) was not touched: none of it addresses a
`contact`, all of it targets an address from `config.json` or a signup
address proving a *new* journal, so there is no contact row for the gate to
ask about — same reasoning as `notifyOwnerOfRequest`.

`test/mail-confirmed-gate.test.ts` is the acceptance test, in two halves:

- Direct unit tests of `mayMailContact` (confirmed passes, unconfirmed is
  refused, the named opt-out overrides), including the literal case the
  acceptance line asks for — a hypothetical sixth sender that forgets to opt
  out is refused.
- An enumeration test: every function in `lib/contacts/mail.ts` and
  `lib/digest/dayLetter.ts` that calls `sendMail(` must also call
  `mayMailContact(` — directly, or by calling a same-file helper that does
  (`sendDayLetter` → `recipientsFor`) — except `notifyOwnerOfRequest`, which
  is named on an explicit allowlist with the reason above. Verified by hand:
  adding a new exported function that calls `sendMail(` without the gate
  fails this test; removing the check inside `mayMailContact` fails the unit
  tests.

`npm run verify` passes. No OpenAPI change — nothing here is a route or a
request field, only which sends actually leave the server.
