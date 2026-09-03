# Sending mail from Fernscout

Development needs no mail account at all. Production needs three DNS records
and a mailbox.

## Development

`features.mail.transport` defaults to `file`. Every message is written as a real
`.eml` under `content/<user>/mail/` — gitignored — and a one-line summary is
printed to the console. Open the file in any mail client to see exactly what a
reader would get, including the plain-text alternative.

One kind of message has no user to be filed under. A **signup code** is
addressed to somebody who does not own a journal yet, so it goes to
`content/.mail/` instead — same format, same rules, also gitignored. That is
the only directory involved besides the per-user ones, and everything
`lib/mail` writes is under the content root: nothing is ever written next to
the code (B111).

That covers the whole flow: digests, one-time codes, approval notices. Nothing
in this project requires a paid mailbox to build or test.

## What a journal's own mail switch governs

`features.mail.enabled` in `content/config.json` says whether this instance can
send at all. It is off unless you set it, because it is the server that holds
the credentials.

`features.mail` in `content/<user>/config.json` is a different kind of switch,
and the only capability in this project that works this way. Every other one is
an **opt-in** — absent means the journal has not asked for the feature, so it is
off. Mail is a **mute button**: a journal does not opt in to being able to send,
it opts out of being written to on its behalf. So it has three states, not two:

| In `content/<user>/config.json` | Means |
| --- | --- |
| absent, or no `features` block at all | **No opinion.** Whatever the server says. This is every journal written before B60, and every journal `createJournal` writes — the line is not added, because a line that changes nothing does not belong in somebody's config. |
| `"mail": { "enabled": true }` | The same. A journal can never widen past a server that has mail off. |
| `"mail": { "enabled": false }` | **Off.** The only "no". |

Which is to say a journal's mail flag can only ever *narrow*, and it narrows
only when somebody asked it to. Reading absence as "no" instead would have
silently stopped the letters of every journal already on disk — nobody's config
would have changed and nothing would have said so, which is a worse failure
than the one B60 fixes.

Switching it off for a journal means **do not write to my readers**. It stops:

- the digest,
- the four contact letters — the join code, the "we have your details"
  confirmation, the "you're in" approval, and the note to the owner that
  somebody has asked,
- the welcome letter a new journal's owner gets.

It does **not** stop three things, and each is exempt for the same reason —
they are addressed to somebody exercising control of the journal, so
suppressing them takes control away rather than granting it:

| Still sent | Why |
| --- | --- |
| One-time **sign-in and agent codes** | The recipient asked for one in that moment, and it is the only way back in. Suppressing it would make the setting unrecoverable: there would be nothing left to sign in with and switch it back on. |
| The **deletion confirmation link** | It *is* the safety mechanism. `DELETE` removes nothing and answers 202; the button in that mail is the only thing that deletes (B38). Swallowing it would leave the API accepting deletions that can never happen. It goes to the owner's own address from `config.json`, never to a reader's. |
| **Operator alerts** (`scripts/alert.mts`) | The box saying its backup failed is not the journal writing to anybody. B64 is what silence there costs. |

In code the distinction is two functions in `lib/mail/index.ts`: `sendMail`,
which is gated by `mail.username`'s journal, and `sendTransactional`, which is
not and takes a written reason as a required argument. A **signup code** has no
journal at all — it is addressed to somebody who does not own a name yet — so
only the server switch applies to it.

Note that switching mail *on* for a journal does not start anything: the digest
and the contact letters have their own opt-in, `features.contacts`, which is an
ordinary one and off unless asked for. Mail is the plumbing, not the tap.

`/api/health` says both halves. A journal that has narrowed mail off appears
under `journals` as:

```json
"someone": {
  "mail": {
    "enabled": false,
    "reason": "not enabled by someone",
    "stillSent": "sign-in codes, deletion confirmations and operator alerts are still sent — a journal's mail switch governs the letters it sends to its readers"
  }
}
```

A journal with no opinion is not narrowing anything, so it does not appear
under `journals` at all — `/api/health` says nothing about it, which is the
truthful answer.

Before B60 none of this was true of the code: every call site asked
`isEnabled("mail")` without the journal, so a per-journal switch narrowed what
`/api/health` *reported* and nothing else. A journal that had said no still got
sign-in codes, digests and — with `keepCopy` on — `.eml` copies of all of it in
a folder whose owner had asked for none. `/api/health` also reported "not
enabled by <name>" for journals that had never mentioned mail, which was the
same lie told the other way round.

## Keeping copies on a server that really sends

`features.mail.keepCopy: true` writes the same `.eml` under
`content/<user>/mail/` — or `content/.mail/`, for a signup code — *in addition
to* sending the message for real. It works over any transport and is **off
unless you set it**.

It exists because on an instance sending real mail, the flows that matter most
cannot be checked: a sign-in code and a journal-deletion link both arrive only
in somebody's inbox, so whoever is testing the site can get as far as "the
endpoint refuses me" and no further.

**Turning it on writes sign-in codes, signup codes, guest invitations and
deletion links to disk in plaintext.** Anyone who can read the filesystem — a
backup, a snapshot, another process on the box — can then sign in as any reader
of that journal, start a journal at somebody else's address, or finish a
deletion. That is the same exposure the `file` transport already has in
development; the difference is that a server has real readers. Turn it on to
debug something, and turn it off again.

### How long they last

**Two days.** A `.eml` older than that is deleted when the next message is
written to the same directory — there is no cron, no timer and no capability
to switch on, because the thing that writes mail is the only thing that has to
know mail exists (B135). It applies to the `file` transport in development and
to `keepCopy` on a server alike; they share the function that writes the file.

The window comes from what the files are for: reading the message you just
triggered. Nothing in the codebase ever reads an old one.

Two limits worth knowing, because "two days" is easy to over-read:

- **A file is readable for those two days**, and a sign-in code is worthless
  long before then (30 minutes) while a deletion link and a guest invitation
  are not. Bounded is not the same as safe.
- **A directory nothing writes to again is never swept.** Sweeping happens on
  write, so a journal that stops sending mail keeps whatever it had. If you
  turned `keepCopy` on to debug something, turn it off *and* clear the two
  directories below — that is still the reliable way to be rid of them.

Clearing it out is two directories, not one:

```bash
rm -f "$CONTENT_DIR"/*/mail/*.eml "$CONTENT_DIR"/.mail/*.eml
```

`/api/health` reports it as `capabilities.mail.keepingCopies`, so you can tell
from outside whether a server is doing this without reading its config.

## Production

Decision 17 chose **Proton SMTP Submission**, which needs a Proton Mail
business plan — and gives you the `fernscout.ch` mailbox you need anyway.

Set in `/etc/fernscout/env`:

```
SMTP_HOST=smtp.protonmail.ch
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM="Fernscout <hello@fernscout.ch>"
```

and `features.mail.transport` to `smtp` in `content/config.json`.

`SMTP_PASSWORD` is Proton's **SMTP token**, generated per-address under
Settings → Import/Export → SMTP submission. It is not the account password and
not the mailbox password, and it is the only one of the three that works here.
`SMTP_USER` is the address the token was issued for, and `MAIL_FROM` must be
that same address or one of its aliases — Proton rejects a sender it has not
authorised, with a 5xx at `MAIL FROM` rather than a bounce later.

### The client

`lib/mail/smtp.ts`, about two hundred lines, no dependency. It does exactly
what submission needs: EHLO, STARTTLS, AUTH PLAIN or LOGIN, one recipient,
DATA, QUIT. It is not an MX client — no DNS, no queue, no retry schedule — and
the moment this journal needs those, it needs a real MTA rather than a longer
version of this file.

Two behaviours worth knowing before you debug something at 3am:

- **It refuses to authenticate over an unencrypted connection.** If the server
  does not advertise STARTTLS, the send fails and no credential is written to
  the socket. Port 465 (`secure`, TLS from the first byte) is chosen
  automatically when `SMTP_PORT=465`.
- **Errors name the step and the SMTP code and never the password** — `AUTH
  PLAIN failed: 535 …`, `RCPT TO failed: 550 …`. That string reaches
  `journalctl`, so it must stay safe to paste.

`test/smtp.test.ts` runs it against a real socket and a real TLS handshake,
including the dot-stuffing and multiline-reply cases, which is what made it
safe to ship without a mailbox in CI.

## DNS — do this before the first digest

Without these, mail from a new domain goes to spam, and the first impression
your family gets of the site is silence.

| Record | Type | Value |
| --- | --- | --- |
| `fernscout.ch` | TXT | `v=spf1 include:_spf.protonmail.ch ~all` |
| `protonmail._domainkey` | CNAME | as shown in Proton's dashboard |
| `_dmarc` | TXT | `v=DMARC1; p=quarantine; rua=mailto:you@fernscout.ch` |

Proton generates the exact DKIM records when you add the domain; take them from
there rather than from this table.

**Verify before relying on it:** send one digest to a Gmail address and one to
an Outlook address, and check both landed in the inbox rather than spam. Then
check the raw headers show `spf=pass` and `dkim=pass`.

The cheapest end-to-end check on a live instance is the login code — it uses
the same transport as everything else:

```bash
curl -s -X POST https://<domain>/api/auth/request \
  -H 'content-type: application/json' \
  -d '{"user":"<user>","email":"<the journal owner>","kind":"agent"}'
# 202 always, by design. Whether it sent is in the log:
journalctl -u fernscout -n 20 | grep mail
```

A successful send logs `[mail:smtp] <recipient> — "<subject>" -> 250 …`. A
failure logs the step and the code.

## Deliverability, honestly

At 20–50 recipients (decision 6) you are far below any rate limit, and Proton's
sending reputation is good. What will actually hurt you:

- **No plain-text alternative.** Every mail here has one, by construction.
- **No unsubscribe.** Every bulk mail carries `List-Unsubscribe` headers.
- **A cold domain sending to 50 people at once.** Send yourself a few first.
- **Image-heavy mail.** The template uses none.
