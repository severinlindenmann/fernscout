---
id: B135
title: Kept mail has no expiry, so a one-time code stays readable on disk long after it stopped working
type: ISSUE
priority: medium
complexity: low
area: mail, ops, security
found: "2026-09-03"
started: "2026-09-03T19:20:43Z"
session: d3574848-24a5-45ec-90ce-a52b8c8fe222
claimed: "2026-09-03T19:20:43Z"
---

# B135 — Kept mail has no expiry, so a one-time code stays readable on disk long after it stopped working

## Why

Split out of **B111**, which named it and deliberately did not do it: B111 moved
signup codes from `process.cwd()` to `content/.mail/` so that every `.eml` the
instance writes is under the content root. That fixed *where* they land. It did
nothing about *how long they stay*, and that gap belongs to every kept message,
not just the one class B111 was about.

Nothing in the codebase ever deletes an `.eml`. `writeEml`
(`lib/mail/index.ts`) writes; the only removal is a person running `rm`.
B57 accepted that consciously — "they stay there until somebody removes them" —
on the reasoning that an operator turns `keepCopy` on to debug something and
turns it off again. Two things have since made that reasoning weaker than it
reads:

- **`keepCopy` is on right now at fernscout.ch and has been for days.** See
  B102: `/api/health` reports `keepingCopies: true` on the live instance. The
  "turn it on, turn it off" discipline is not what happens in practice.
- **After B111 these files are inside `CONTENT_DIR`, which the backup covers.**
  `scripts/backup.sh` archives `CONTENT_DIR` wholesale and has no excludes, so
  a plaintext sign-in code now propagates into restic snapshots and lives for
  the retention period of the backup, not the life of the directory. That is
  the correct trade — B111's whole point was that mail belongs with the data
  rather than next to the code — but it raises the cost of never deleting.

What the exposure actually is: a sign-in code and a signup code expire in 30
minutes (`CODE_TTL_MS`), so a stale one is worthless. A **journal-deletion
link** and a **guest invitation** are the ones that matter — those are single-use
but long-lived, and an old `.eml` holding one is a live credential sitting in a
directory nobody revisits.

## Work

Give kept mail a lifetime, without inventing a scheduler.

- Sweep on write is probably enough: when `writeEml` creates a file, remove the
  `.eml` files in that directory older than some small number of days. No cron,
  no unit, no new capability — the thing that writes mail is the only thing that
  needs to know mail exists.
- Pick the window from what the files are *for*. They exist so somebody
  debugging a flow can read the message they just triggered; a day or two covers
  that, and nothing in the codebase reads an old one.
- Whatever the window is, say it where B57's cost is written down:
  `docs/archiv/deploy-mail.md`, and the `keepsCopy()` note in `lib/mail/index.ts`
  which currently promises they stay "until somebody removes them".
- Consider whether the sweep should also apply to the `file` transport in
  development. It should — same files, same reason — and it keeps the two paths
  from diverging.

## Built

`sweepExpiredMail()` in `lib/mail/index.ts`, called from `writeEml` after the
`mkdir` and **before** the write, so the message being written is never a
candidate for its own sweep. `KEPT_MAIL_TTL_MS` is **two days**.

- **In `writeEml`, not in its two callers.** The file transport and `keepCopy`
  produce the same files for the same reasons, so they get the same lifetime —
  a window that applied to only one of them is a difference nobody could
  justify later. That also answers the last Work bullet: development is swept
  on identical terms.
- **Two days**, from what the files are for rather than from how long their
  contents stay valid. The latter varies and is not this module's to know: a
  sign-in code is worthless after 30 minutes, and a deletion link and a guest
  invitation are single-use but long-lived, which is what makes an old `.eml` a
  live credential. Two days covers a flow debugged on a Friday and looked at
  again on a Sunday.
- **Never throws, and is quiet about one stubborn file.** An unreadable
  directory warns once and gives up; a single file that will not unlink is
  skipped silently, because the next message tries again and a warning on every
  send is how a log stops being read. `keepCopyOf` already sets that precedent.
- **Only `.eml`, only files, only that one directory.** Mail folders are
  gitignored and shared with nothing, but a line that deletes things by age
  should have its blast radius stated rather than assumed.

Two limits, written into `docs/archiv/deploy-mail.md` rather than left for a
reader to discover, because "two days" reads safer than it is:

- a file is readable for those two days, so this bounds the exposure and does
  not remove it;
- **a directory nothing writes to again is never swept.** Sweep-on-write means
  a journal that stops sending mail keeps whatever it had. Clearing the two
  directories by hand is still the reliable way to be rid of them, and the doc
  still says so.

Not doing: excluding mail from the backup. Two directories under `CONTENT_DIR`
that the backup deliberately skips is a rule somebody has to remember, and the
files should not be old enough to matter in the first place. Nor is this a
reason to reconsider `keepCopy` itself (B57) or where mail lands (B111); both
are settled.

## Acceptance

- A `.eml` older than the window is gone after the next message is written to
  that directory, and one inside the window is untouched. A test covers both.
- The sweep never fails a send: a directory it cannot read is a warning, the
  same way `keepCopyOf` already treats a copy it cannot write.
- `docs/archiv/deploy-mail.md` states the lifetime, and no longer says the files
  stay until somebody removes them.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
