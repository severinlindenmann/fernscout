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
deletion links to disk in plaintext**, and they stay there until somebody
deletes them. Anyone who can read the filesystem — a backup, a snapshot,
another process on the box — can then sign in as any reader of that journal,
start a journal at somebody else's address, or finish a deletion. That is the
same exposure the `file` transport already has in development; the difference is
that a server has real readers. Turn it on to debug something, and turn it off
again.

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
