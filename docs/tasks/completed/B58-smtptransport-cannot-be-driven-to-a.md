---
id: B58
title: SmtpTransport cannot be driven to a successful send from a test
type: CHORE
priority: low
complexity: low
area: mail, testing
found: "2026-09-01"
started: "2026-09-04T05:58:31Z"
merged: "2026-09-04T06:14:50Z"
completed: "2026-09-04T07:30:54Z"
---

# B58 — SmtpTransport cannot be driven to a successful send from a test

## Why

Found while building B57. There is a fake SMTP server (`test/fixtures/smtp-server.ts`)
and `test/smtp.test.ts` drives the *client* through a real socket and a real
TLS upgrade — but it does so by calling `sendSmtp` directly and passing
`ca: TEST_CERT`.

`SmtpTransport` (`lib/mail/index.ts`) builds its config from the environment —
host, port, user, password, `secure`, `clientName` — and has no CA option. The
fake server's certificate is self-signed, and the client correctly refuses a
server that offers no STARTTLS (`test/smtp.test.ts`, *"refuses to send when the
server offers no STARTTLS"*), so there is no way to reach a successful send
through `sendMail`. The attempt fails with `self-signed certificate`.

Consequence: everything from `sendMail` down to the socket is covered on the
failure path only. B57 could test that a copy is kept for a non-`file`
transport (via `console`) and that a *failed* smtp send leaves no copy, but not
the combination that will actually run in production — smtp succeeded, copy
written. That combination is currently only exercised by hand.

This is small and it is not urgent. It is worth writing down because the
missing test looks like an oversight in `test/mail.test.ts` rather than a
structural gap, and the next person will otherwise spend the same half hour
discovering the certificate is the reason.

## Work

Give `SmtpTransport` a way to be handed trust material, used by tests and
nothing else, and add the missing case to `test/mail.test.ts`.

- The obvious shape is an env var read alongside the others — but note that
  `SMTP_CA` reachable in production is a way to make a server trust an
  arbitrary certificate, which is a downgrade dressed as configuration. Prefer
  something that cannot be set on a real deployment, or accept the CA through a
  seam only the test can reach.
- Then assert what B57 could not: a successful smtp send with
  `features.mail.keepCopy: true` leaves exactly one `.eml`, and with the
  setting absent leaves none.

Not doing: reworking the transport interface so the message is built once and
shared. That is the related and larger question in B57's own notes — the copy
is currently a faithful re-render rather than the exact bytes that went down
the socket.

## Acceptance

- `test/mail.test.ts` covers smtp-succeeded-and-copy-written against the fake
  server, and smtp-succeeded-and-no-copy without the setting.
- Whatever admits the CA cannot be used to weaken TLS on a real deployment, and
  the reason is written where somebody changing it will read it.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.

## Done — 2026-09-04

**The seam is a function, not an environment variable.** `SMTP_CA` read
alongside the others would be a supported way to make a deployed server trust
an arbitrary certificate: anybody who can set env on the box, or talk an
operator into a line in a unit file, turns submission into something a
machine-in-the-middle can terminate — and the client would report a clean send.
So there is no configuration surface at all. `setSmtpTrustAnchorForTests` in
`lib/mail/index.ts` throws unless `NODE_ENV === "test"`, which a Next
production build never is, and the reason is written in its docstring where
somebody changing it will read it. An operator with a private CA installs it in
the system trust store, which is one deliberate decision rather than a string
in a config file nobody re-reads.

`SmtpTransport` passes it through as `ca`, undefined everywhere but a test.

Five cases in `test/mail.test.ts`, under *"the smtp transport, from sendMail
down to the socket"* — all failing before the seam existed, all passing after:

- *a message really crosses the wire, encrypted and authenticated* — the whole
  path from `sendMail` to the fake server's socket, asserting the TLS upgrade
  happened and that no `AUTH` command was spoken before it. That last one is
  asserted here as well as in `test/smtp.test.ts` because this is the path
  carrying a real password read from the environment.
- *with keepCopy on, a successful send leaves exactly one .eml* — the
  combination B57 could not reach.
- *without the setting, a successful send leaves nothing on disk*.
- *without the anchor the same send is refused, so verification is real* — the
  test that makes the three above evidence about TLS rather than about a check
  somebody switched off. Without the anchor the fixture's self-signed
  certificate is rejected, exactly as this task described.
- *the trust seam refuses to run anywhere but a test*.

Not done, as stated above: reworking the transport interface so the message is
built once and shared. The copy is still a faithful re-render rather than the
exact bytes that went down the socket — B57's own question, still open.
