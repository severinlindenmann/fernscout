---
id: B60
title: A journal that switched mail off still has mail sent on its behalf
type: ISSUE
priority: medium
complexity: low
area: mail, capabilities
found: "2026-09-01"
started: "2026-09-03T19:23:10Z"
session: a4b53c2f-00e4-4e62-bc65-91f1f227b1e1
claimed: "2026-09-03T19:23:10Z"
---

# B60 — A journal that switched mail off still has mail sent on its behalf

## Why

Found on the live server while verifying B57. `/api/health` reports, for the
journal `sevi`:

```json
"sevi": { "mail": { "enabled": false, "reason": "not enabled by sevi" } }
```

Requesting a sign-in code for that journal sent one anyway, and — with B57's
`keepCopy` on — wrote the copy into `content/sevi/mail/`.

`isEnabled(name, username?)` (`lib/capabilities.ts:156`) takes the journal, and
`resolveOne` narrows the server-wide answer with that journal's own config.
**Every mail call site omits the argument:**

- `lib/mail/index.ts:262` — `sendMail`, which already has `mail.username` in
  its hand and does not pass it
- `lib/journals.ts:285` — the welcome letter
- `lib/deletions.ts:223` — the deletion confirmation link
- `lib/digest/index.ts:274` — the digest
- `app/api/auth/signup/request/route.ts:27`

So a per-journal `features.mail.enabled: false` narrows what `/api/health`
*reports* and nothing else. That is the "absent, not broken" rule in
`AGENTS.md` inverted: the capability is reported off while the feature runs.
Somebody switching mail off for their journal — the obvious way to say *do not
write to my readers* — gets no indication it did not take.

B57 makes it worse rather than causing it: those journals now also accumulate
`.eml` copies containing live sign-in links, in a folder whose owner has said
they do not want mail at all.

### Corrections found while building it

The Why above is accurate about the defect and about `sendMail` being the one
place to fix it. Four things it did not know:

1. **The call-site list was short.** It missed `lib/contacts/mail.ts` (four
   letters — the join code, the confirmation, the approval, and the note to the
   owner), `app/api/auth/request/route.ts:160` — which is the send that was
   actually reproduced on the live server — and `scripts/alert.mts:126`. All of
   them route through `sendMail`, so one gate covers them; the list matters
   only for classifying them.

2. **`app/api/auth/signup/request/route.ts` was never part of the bug.** A
   signup code is addressed to somebody who does not own a name, so it carries
   no `username` and there is no per-journal switch to consult. Its
   server-wide `isEnabled("mail")` is the whole correct answer, and it is
   unchanged. That is now stated in `sendMail`'s doc comment rather than left
   looking like an omission.

3. **A user's `features.mail` defaulted to off** (`DEFAULT_FEATURES` in
   `lib/config.ts`), so "a journal that switched mail off" was in practice
   *every journal that has never mentioned mail* — which is every journal on
   disk, `content/example` included. Gating on that would have silently stopped
   the welcome, the digest and every contact letter for all of them, with no
   config change by any owner and nothing announcing it: a worse failure than
   the bug this task fixes. **A journal that has never mentioned mail has not
   switched it off.** See "The three states" below.

4. **A second, unrelated defect: see B160.** `POST /api/auth/request` never
   checks `isEnabled("mail")` at all, so on an instance with mail off
   server-wide it issues a code — revoking any earlier live one — and answers
   202 having sent nothing. That is the server switch, not the journal's, and
   it is captured rather than absorbed.

## Work

### The three states, and why absence is not "no"

A user's `features.mail` is **not an opt-in**, and it is the only capability
here that is not. Every other one — `contacts`, `postcards`, `push`, `auth` —
says "I want this feature on my journal", so absent means "I have not asked for
it" and off is both the safe and the obvious reading; the failure mode is a
feature that does not appear, which is visible and recoverable. Mail is a
**mute button**: a journal does not opt in to being able to send, it opts out
of being written to on its behalf. Read absence as "no" and the failure mode
inverts into silent suppression.

`scripts/migrate-users.ts` settles it. When this project went multi-user it
filed `mail`, `auth`, `contacts` and `photobook` under the **server** config and
only `reactions`, `costs`, `push` and `postcards` under the user's. The
per-journal `mail` key exists at all only because one `parseFeatures` runs over
both files. Nobody ever chose it as a per-journal opt-in.

| In `content/<user>/config.json` | Means |
| --- | --- |
| absent, or no `features` block | **No opinion** — whatever the server says |
| `"mail": { "enabled": true }` | The same; a user can never widen past a server with mail off |
| `"mail": { "enabled": false }` | **Off** — the only "no" |

So a journal's mail flag can only ever *narrow*, and now it narrows only when
somebody asked it to. Implemented as `USER_DEFAULT_FEATURES` in `lib/config.ts`
— the server's table with one entry changed — rather than as a branch in
`resolveOne`, which is untouched: it checks the server first and returns early,
which is what makes the table incapable of widening anything.

**No migration is needed, and `createJournal` does not write the key.** A line
saying `true` would change nothing, and this file already argues (about
`visibility`) that the owner reading their own config should find the lines
that are doing something. Writing it would also make journals created after
this commit behave differently from every journal already on disk, which is
precisely the difference that must not exist. The `mail: { enabled: true }`
line an earlier draft of this task added to `createJournal` is therefore
**reverted**.

One consequence worth stating plainly: on the production data as it stands, no
journal has an explicit `false`, so this changes nothing about what is
delivered there. What changes is `/api/health`, which stops reporting `"not
enabled by sevi"` for a journal that never said so — the same lie told the
other way round — and the fact that writing `false` now works.

### "Cannot tell" is not a no either

Found after the merge: main went red on `test/mail.test.ts > kept mail expires
> a sweep that cannot read the directory still sends the message`, a B135 test
that did not exist when this branch was cut.

The mechanism is one layer below the three states above. B135's test mocks
`fs.readdirSync` to throw `EACCES`, meaning to break the kept-mail sweep. The
gate here called `isEnabled("mail", username)`, which reaches `getUser` →
`getUsernames` → the same `fs.readdirSync` (`lib/users.ts:117`), which catches
its own failure and returns an empty list. So the journal could not be
resolved, `resolveOne` answered `no such user "ana"`, and the send was declined.

**The mock is broader than the sweep it means to break, but that is not the
defect.** Strip the mock away and the behaviour reads: *when a journal's config
cannot be read, its mail is silently suppressed.* An unreadable directory is
not somebody saying no. That is the same silent-suppression failure this task
was already sent back once to remove — absence read as refusal — one level
down, with "cannot tell" in place of "did not say".

So the gate was narrowed rather than the mock. It now asks the two questions
separately:

- **Can this server send?** `isEnabled("mail")`.
- **Has this journal said no?** `hasSwitchedOff("mail", username)`, new in
  `lib/capabilities.ts` — `getUser(username)?.features[name]?.enabled === false`.
  A stated `false` is a no; absence is not (the user default is on); an
  unresolvable journal is not.

Why this and not the other options:

- **`resolveOne` is untouched.** Returning false for an unresolvable user is
  long-standing and shared with every capability; changing it has a blast
  radius well past mail. The narrower question belongs at the gate that needs
  it.
- **It is a smaller change than what was merged, not a larger one.** Before
  B60, `sendMail` never consulted the user at all, so an unresolvable journal
  always reached the transport. This restores exactly that and adds only the
  stated refusal.
- **Nothing about where a message may be written rests on it.** The
  content-root guard in `mailDir` is that boundary and is unchanged — which is
  why `test/mail.test.ts`'s escape test could go back to calling `sendMail`
  rather than the exempt path, as it did before this branch touched it.
- **The trade, stated plainly.** Failing open costs at most one letter to a
  journal that had said no, during an outage in which its config is
  unreadable. Failing closed costs every journal's mail, silently, for as long
  as the fault lasts.

`/api/health` still agrees with behaviour: it iterates `getUsernames()`, so it
can only ever report on journals it can resolve, and for those the gate and
`resolveOne` give the same answer. A journal it cannot resolve is not reported
at all, so there is no disagreement to observe.

B135's test is left with its broad mock deliberately. It now pins a property
worth having beyond the sweep — an I/O fault in the readdir path does not
swallow a message — and `test/mail-journal-switch.test.ts` names that property
directly rather than leaving it incidental to a test about expiry.

### What the switch means — the decision, and why

**A journal's `features.mail.enabled` governs the letters that journal writes
to its readers.** Off means *do not write to my readers*. It stops the digest,
the four contact letters, and the welcome.

**It does not govern letters about access to the journal itself.** Three
classes are exempt, and they share one reason: each is addressed to somebody
exercising control of the journal, so withholding it takes control away rather
than granting it.

| Still sent | Why |
| --- | --- |
| One-time **sign-in and agent codes** | The recipient asked for one in that moment, and it is the only way back in. Suppressing it makes the setting unrecoverable — there is nothing left to sign in with and switch mail back on. |
| The **deletion confirmation link** | It *is* the safety mechanism (B38): `DELETE` removes nothing and answers 202, and only the button in that mail deletes. Swallowing it leaves the API accepting deletions that can never happen. It goes to the owner's own address from `config.json`, never a reader's. |
| **Operator alerts** (`scripts/alert.mts`) | The box saying its backup failed is not the journal writing to anybody. B64 is what silence there costs. |

The server-wide switch still stops all three: an instance that cannot send mail
cannot send these either, and `lib/deletions.ts` refuses that flow up front
with a 404 rather than accepting it silently.

### What was built

- **`lib/mail/index.ts`** — `sendMail` now asks `isEnabled("mail",
  mail.username)`, which covers every caller that files its mail under a
  journal. A new **`sendTransactional(mail, reason)`** is the exception, and
  `reason` is a required argument so "why is this one exempt" is answered at
  the call site rather than inferred from a missing one. It logs the bypass
  only when the journal really has mail off, so the operator who sees a code
  arrive can find the line that explains it. Both share a private `deliver()`,
  so the `keepCopy` behaviour cannot drift between them.
- **`lib/mail/types.ts`** — `TRANSACTIONAL_MAIL_NOTE`, one sentence naming the
  exempt classes, quoted by `/api/health` and by the docs so they cannot
  disagree.
- **`app/api/auth/request/route.ts`, `lib/deletions.ts`, `scripts/alert.mts`**
  — the three exempt call sites, each with its reason in prose above the call.
- **`lib/config.ts`** — `USER_DEFAULT_FEATURES`, and `parseFeatures` takes the
  table to use. One entry differs from the server's; every other capability is
  untouched.
- **`lib/capabilities.ts`** — `hasSwitchedOff(name, username)`, the narrow
  question the mail gate asks, plus a comment at `resolveOne`. `resolveOne`
  itself is unchanged: it still reads the server first and returns early, so a
  user's `true` cannot widen anything.
- **`lib/journals.ts`** — `sendWelcome` gates on the journal. `createJournal`
  deliberately does *not* write a `mail` key (see the three states above).
- **`lib/digest/index.ts`** — a second refusal naming the journal, kept
  separate from the server-wide one because the file to edit differs.
- **`app/api/health/route.ts`** — a journal whose `mail` is narrowed off now
  carries `stillSent`, so the block stops being half a truth.
- **`docs/archiv/deploy-mail.md`** — a new section, "What a journal's own mail
  switch governs", carrying the table above.

### Not done here

- The server-wide 202 on `/api/auth/request` — B160.
- Route-level refusals for the contacts join flow when a journal has mail off.
  The letters are suppressed at `sendMail`, which is the guarantee; whether
  `POST /api/contacts/request` should also answer something other than 202 is
  the same question as B160 and belongs with it.

## Acceptance

- A journal with `features.mail.enabled: false` receives no mail of whatever
  classes the decision above says it should not, asserted by a test per class.
- A journal whose config has no `features.mail` key is unaffected — its
  welcome, digest and contact letters still go — asserted by a test.
- A journal whose config cannot be *read* is likewise not treated as a refusal,
  asserted by a test that mocks `readdirSync` into failing.
- Any class deliberately exempt is named in the test and in the docs, with the
  reason.
- `/api/health`'s per-journal mail block agrees with what actually happens.
- No `.eml` copy is written for a journal whose mail is suppressed.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.

### Evidence

`test/mail-journal-switch.test.ts` is the new file, one describe block per
class, plus a block for the journal that never mentioned mail — a fixture whose
config has no `features` key at all, asserting its welcome, its contact letters
and its digest all still go, that a stated `false` beside it is still a no, and
that it still cannot send when the server cannot. `test/alert-script.test.ts`
carries the operator-alert exemption, where the script is run for real against
the file transport.

Checked by reverting rather than asserted: 5 of the 17 fail against the pre-fix
`lib/` (the three gates and the health field), and a different 5 fail if the
user default for mail is off — which is the shape this task nearly shipped as.
