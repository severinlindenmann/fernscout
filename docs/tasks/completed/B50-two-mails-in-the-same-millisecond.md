---
id: B50
title: Two mails in the same millisecond overwrite each other in development
type: ISSUE
priority: low
complexity: low
area: mail
found: "2026-09-01"
started: "2026-09-03"
merged: "2026-09-03T19:17:45Z"
completed: "2026-09-04T07:30:54Z"
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

## What was built

**`flags: "wx"` plus a trailing counter**, not a random suffix. The Work
section offered both; the deciding argument is that `wx` fails rather than
truncating, so the collision becomes an `EEXIST` the function can answer
instead of an event nobody observes. A random suffix would have made every
filename noisier to solve a problem that occurs in a burst, and it would still
have been a guess rather than a claim — two random names can collide, and
nothing would have said so.

The loop claims the name and writes it in one step, so there is no window
between "this name is free" and "it is mine" for the next message to slip
into. That is the reason not to `existsSync` first.

- `lib/mail/index.ts` — `writeEml` builds `base` from timestamp, recipient and
  subject as before, then tries `base.eml`, `base-2.eml`, … up to
  `MAX_SAME_NAME` (100), writing with `wx` each time and treating only
  `EEXIST` as "try the next one". Anything else still throws. Past 100 it
  throws rather than returning somebody else's file: the contract is that a
  message handed to this function is on disk when it returns.
- **The timestamp stays in front and the counter trails it.** The task asked
  for this and it is worth restating, because it is the one part a tidier
  naming scheme would get wrong: sorting the folder by name is how a person
  finds the mail they just triggered, and a counter in front would reorder
  everything around it.

### The test does not race the clock

The acceptance asks for two files "without relying on the clock advancing",
and that is the whole difficulty — a test that sends twice and hopes the
millisecond does not tick over is the flake B50 is about, and it asserts
nothing on the runs where it matters. Both new tests in `test/mail.test.ts`
freeze the clock with `vi.setSystemTime` (already used elsewhere in the file),
so the collision is forced on every machine and every run.

Against the pre-change `writeEml`, both fail:

```
× two identical messages in one millisecond leave two files
× the counter trails the timestamp, so the folder still sorts by time
  Tests  2 failed | 23 passed (25)
```

### Not touched

`slug()` at `lib/mail/index.ts:22` still has no NFD pass, so "Grüße vom Weg"
becomes `gr-e-vom-weg`. That is **B86**'s "while there" note and was left
alone deliberately: B86 was being built in a parallel worktree against this
same file. The two do not interact — B86 is about what the slug contains and
this is about what happens when two names come out identical — and a fix to
either is unaffected by the other.

The comment above `slug()` was corrected in passing: it claimed the slug was
"kept unique by the timestamp it is joined to", which was the assumption this
task disproves. Uniqueness is `writeEml`'s job and the comment now says so.
