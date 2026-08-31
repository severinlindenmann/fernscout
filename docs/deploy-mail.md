# Sending mail from Fernscout

Development needs no mail account at all. Production needs three DNS records
and a mailbox.

## Development

`features.mail.transport` defaults to `file`. Every message is written as a real
`.eml` under `content/<user>/mail/` — gitignored — and a one-line summary is
printed to the console. Open the file in any mail client to see exactly what a
reader would get, including the plain-text alternative.

That covers the whole flow: digests, one-time codes, approval notices. Nothing
in this project requires a paid mailbox to build or test.

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

> **The SMTP transport is not implemented yet.** It throws a clear error rather
> than pretending to send. Shipping an untested SMTP client would be worse than
> shipping none, and it cannot be tested without a paid mailbox. The capability
> registry already knows which variables it needs, so turning it on without them
> fails at boot rather than at send time.

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

## Deliverability, honestly

At 20–50 recipients (decision 6) you are far below any rate limit, and Proton's
sending reputation is good. What will actually hurt you:

- **No plain-text alternative.** Every mail here has one, by construction.
- **No unsubscribe.** Every bulk mail carries `List-Unsubscribe` headers.
- **A cold domain sending to 50 people at once.** Send yourself a few first.
- **Image-heavy mail.** The template uses none.
