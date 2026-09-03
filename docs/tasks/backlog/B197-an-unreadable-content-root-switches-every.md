---
id: B197
title: An unreadable content root switches every journal's mail off instead of warning
type: ISSUE
priority: high
complexity: low
area: mail, capabilities, tests
found: "2026-09-03T19:58:00Z"
---

# B197 — An unreadable content root switches every journal's mail off instead of warning

## Why

**`main` is red.** `test/mail.test.ts > kept mail expires > a sweep that
cannot read the directory still sends the message` fails on `main` as it
stands, and has since B60 merged (`1de8fd9`, merge `d374629`). Found while
building B159, in a full run on a branch based on `main`; confirmed by
stashing every local change and running the file alone. It is nobody's
uncommitted state — it is the committed tree.

The test mocks `fs.readdirSync` to throw `EACCES` and asserts that a message
is still sent, because sweeping expired `.eml` files is housekeeping and
`sweepExpiredMail` (`lib/mail/index.ts:134`) documents in bold that it **never
throws** — "refusing to send mail because an old file would not delete would
be a worse bug than the one this fixes".

The sweep still keeps that promise. What changed is above it. B60 added the
per-journal gate at `lib/mail/index.ts:353`:

```ts
if (!isEnabled("mail", mail.username)) return null;
```

`isEnabled` with a username has to resolve the journal, which reaches
`getUsernames()` (`lib/users.ts:112`) — and that is a `readdirSync` over the
content root, wrapped in a `catch` that caches an empty list and returns:

```ts
try {
  entries = fs.readdirSync(root, { withFileTypes: true });
} catch {
  cache.set(root, { signature: "", names: [] });
  return [];
}
```

No journals means no such user, which means the capability is off, which means
`sendMail` returns `null`. So an unreadable content root does not produce an
error, a warning or a retry: **every journal on the instance silently stops
sending mail, and the empty answer is cached.**

That is the same failure mode B60's own commit message rules out — "silent
suppression … nobody's config would have changed and nothing would have said
so" — arrived at through a different door. It is filed `high` for that reason
rather than for the red test: sign-in codes, guest invitations and
journal-deletion links all go through `sendMail`, and a content root that
briefly cannot be read takes them all down with nothing in the log.

Two things this is **not**. It is not the sweep: that catch is correct and
should stay. And it is not an argument against the per-journal gate, which is
what B60 was for.

## Work

- Decide what "I cannot tell whether this journal exists" should mean at
  `lib/mail/index.ts:353`. It is not the same answer as "this journal has
  switched mail off", and today the two are indistinguishable. The B60
  reasoning says absence is not an opt-out; an unreadable directory is even
  less of one.
- Whatever is decided, an unreadable content root must say so once rather than
  never — `getUsernames`'s bare `catch` is where the information is lost, and
  caching the empty result means the warning would not repeat on every call.
- Fix the test, or fix the code the test is right about. Do not simply widen
  the mock: the test asserts a documented promise, and it is the promise that
  broke.
- Check the other capability gates for the same path. `isEnabled(x, username)`
  is now on the critical path of several things, and each one inherits "the
  directory could not be read" as "the feature is off".

## Acceptance

- `npx vitest run test/mail.test.ts` passes on `main`.
- A content root that cannot be read produces a warning naming the cause, and
  the behaviour that follows is the one the task chose, written down where the
  gate is.
- A test drives the unreadable-root case through `sendMail` directly, so the
  property is guarded somewhere it is the subject rather than a side effect of
  a sweep test's mock.
