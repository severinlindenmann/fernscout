---
id: B57
title: A journal sending real mail keeps no copy, so nothing that went out can be read back
type: FEATURE
priority: medium
complexity: low
area: mail, ops, config
found: "2026-09-01"
started: "2026-09-01"
---

# B57 — A journal sending real mail keeps no copy, so nothing that went out can be read back

## Why

`FileTransport` writes a real `.eml` under `content/<user>/mail/` and prints
the path, and that one behaviour is what makes the whole product testable
without a mail account — the sign-in code, the welcome letter, the digest, the
deletion link. `SmtpTransport` sends and keeps nothing: it deliberately logs
the recipient and not the message, *"a one-time code must not end up in the
journal"* (`lib/mail/index.ts:99`).

That is right for a production instance and wrong for the one this project
actually runs on. Verifying the B38 deletion flow against fernscout.ch was
impossible for exactly this reason: mail is `transport: "smtp"` with no
`AUTH_DEV_CODE`, so the confirmation link — the thing the whole feature turns
on — goes to an inbox the person testing may not hold. The same blocks every
signed-in path, because a guest session starts with a six-digit code in a mail.
Two of the five things shipped on 2026-09-01 could be verified only as far as
"the endpoint refuses me", and that is not verification.

The gap is narrow. Both transports already build the identical message through
`buildMessage`; only one of them writes it down.

## Work

A switch that keeps a copy of every message on disk, whatever transport sent
it — the same `.eml`, in the same place, with the same name the file transport
would have used.

- `features.mail.keepCopy` in `content/config.json`. `FeatureConfig` is
  `{ enabled: boolean; [key: string]: unknown }` (`lib/config.ts:129`), so this
  needs no schema change.
- **Absent means off**, and it must stay off in the repository's own
  `content/config.json`. This is the rule in `AGENTS.md` — every optional
  capability off by default — and here it carries real weight rather than being
  a convention.
- Applies to `smtp` and `console` alike. "Send it for real *and* leave me a
  copy" is the request; the transport it is layered over is not the point.
- Factor the writing out of `FileTransport` so one function writes the file and
  both paths call it. Two copies of this would drift, and the second copy is
  the one nobody tests.
- A failed copy must not fail the send. The mail has gone; a full disk is not a
  reason to report failure to a caller that would then retry and send it twice.
  Log and carry on.
- Copy after a successful send, not before. A `.eml` on disk for a message that
  never left is worse than no `.eml` — it is a debugging aid that lies.
- `/api/health` should say when it is on, in the `mail` capability block. An
  operator needs to be able to see that their server is writing copies of every
  one-time code without reading the config file.

## The security note, which is the whole reason this is a switch

Turning this on writes **sign-in codes, guest invitations and journal-deletion
links to disk in plaintext**, under `content/<user>/mail/`, where they sit until
somebody removes them. Anybody who can read the filesystem — a backup, a
snapshot, a misconfigured static route, another process on the box — can sign
in as any reader of that journal and can complete a deletion.

That is not a reason to refuse the feature: it is exactly what the file
transport already does in development, and the person asking owns the server.
It is a reason for the default to be off, for the documentation to say this
plainly rather than describe it as "keeps a copy for debugging", and for
`/api/health` to report it. Say it in the same words in `AGENTS.md` and in the
config documentation.

Not doing: redaction or partial copies. A copy with the code stripped out
cannot answer the question this exists to answer.

## Acceptance

- With `keepCopy` absent, `smtp` writes nothing to `content/<user>/mail/` —
  asserted by a test, because this is the default and the one that must not
  regress.
- With `keepCopy: true`, an `smtp` send leaves an `.eml` whose bytes are
  identical to what the file transport would have written for the same message.
- The same holds for the `console` transport.
- A send whose copy cannot be written still reports success, and logs.
- No copy is written when the send itself fails.
- `/api/health` reports the setting under the `mail` capability.
- The repository's own `content/config.json` still has it off.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
