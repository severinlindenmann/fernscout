---
id: B50
title: Two mails in the same millisecond overwrite each other in development
type: ISSUE
priority: low
complexity: low
area: mail
found: "2026-09-01"
started: "2026-09-03"
---

# B50 — Two mails in the same millisecond overwrite each other in development

## Why

`FileTransport` in `lib/mail/index.ts` names a message by timestamp, recipient
and subject:

```ts
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = path.join(dir, `${stamp}-${slug(mail.to)}-${slug(mail.subject)}.eml`);
```

Two messages to the same address with the same subject inside the same
millisecond therefore land on the same path, and the second silently replaces
the first. `fs.writeFileSync` does not object, nothing is logged, and the count
of files under `content/<user>/mail/` is simply wrong.

Found while writing B38's tests. A test asked for two deletion confirmations in
a row and then read both mails; it passed most of the time and failed roughly
one run in ten, which is the worst way for a helper to be wrong. The test was
changed to consume each mail as it read it, so nothing depends on this any
more — but the transport is still lossy.

Only development and CI are affected: SMTP does not name anything by
timestamp. It matters anyway, because the file transport is what AGENTS.md
points at for "no feature needs a paid account to develop or test", and a
mailbox that quietly drops messages is a poor thing to debug against. Anything
that sends two letters in a burst — a digest run, a deletion asked for twice,
an ingest that notifies — can lose one.

## Work

Make the filename unique. A short random or monotonic suffix is enough; or
`flags: "wx"` on the write and retry with a counter, which also makes the
collision visible rather than silent. Keep the timestamp first so a directory
listing still sorts by time, which is what makes the folder readable.

## Acceptance

- Sending two identical messages in a tight loop leaves two `.eml` files.
- A test asserts it, without relying on the clock advancing.
