---
id: B111
title: Signup codes are written outside the content directory, where nobody is looking for them
type: ISSUE
priority: medium
complexity: low
area: mail, ops, security
found: "2026-09-03"
started: "2026-09-03"
---

# B111 — Signup codes are written outside the content directory, where nobody is looking for them

## Why

`writeEml` picks the directory from the message's user (`lib/mail/index.ts:57`):

```ts
const dir = mail.username
  ? path.join(contentRoot(), mail.username, "mail")
  : path.join(process.cwd(), "mail");
```

A signup code has no journal yet — it is the mail you get *before* you own a
name — so `app/api/auth/signup/request/route.ts:81` calls `renderMail(email,
subject, content)` and never reaches the optional fourth argument
(`lib/mail/template.ts:103`). Every signup code therefore takes the second
branch and lands in the working directory, which on the deployed server is the
code checkout: `/srv/fernscout/mail/`.

Observed on fernscout.ch. `/var/lib/fernscout/content/*/mail/` — the documented
location, and the one under `DATA_DIR` — is empty. `/srv/fernscout/mail/` holds
three plaintext signup codes, the oldest from 2026-09-01:

```
2026-09-01T18-10-19-665Z-relaytest-severin-io-your-code-to-start-a-journal…eml
2026-09-01T19-01-44-341Z-test1-severin-io-your-code-to-start-a-journal…eml
2026-09-03T17-32-08-518Z-xydhd-qa1-severin-io-your-code-to-start-a-journal…eml
```

B57 introduced `keepCopy` and was explicit about the cost: copies are plaintext
and "sit until somebody removes them". That was accepted deliberately and is
not what this task is about. What B57 did not anticipate is that **one class of
mail does not go where B57 says it goes.** Its security note, the config
documentation and `AGENTS.md` all name `content/<user>/mail/`. An operator who
reads that and clears it out has not cleared out the signup codes, and has no
reason to suspect a second directory exists.

Three consequences, in order of how much they cost:

- **The cleanup nobody knows to do.** The documented path is the one people
  will act on. This one is invisible until somebody goes looking, and the files
  above show what "until somebody removes them" means in practice when nobody
  knows there is anything to remove.
- **It is outside `DATA_DIR`.** Everything else the instance keeps about a
  person lives under `/var/lib/fernscout`, which is what the backup covers and
  what a deploy leaves alone. This directory is in neither regime — it is in
  the checkout that `git pull` runs in, and it is untracked (`.gitignore:49`
  has `/mail`, so at least it cannot be committed).
- **`/api/health` implies the wrong place.** `keepingCopies: true` tells an
  operator copies are being written; the docs tell them where; for signup codes
  both together are wrong.

The payload is the mildest of the three kinds of mail B57 warned about: a
signup code is single-use, expires in 30 minutes, and creates a *new* journal
rather than opening an existing one. A stale one is worthless. The live window
is small and real, though, and the reason to fix this is less the code itself
than that a documented security property is not true of every message.

### What reading the code changed

Everything above held: the branch, the call site, the optional fourth argument,
and `.gitignore:49`. Two things were wrong by omission.

**Signup is not the only caller taking that branch.** `scripts/alert.mts:126`
sends the backup-failure alert with `username: getDefaultUsername() ?? undefined`
— so on any instance whose `content/config.json` names no `site.defaultUser`,
the mail telling somebody the nightly backup failed went to `process.cwd()/mail/`
too. It has never been seen because fernscout.ch does name a default user, and
`test/alert-script.test.ts` always writes one. The same fix covers it, and the
reason it covers it is exactly the reason the Work section preferred fixing the
fallback over teaching the signup route a reserved name. Every other caller —
`app/api/auth/request`, `lib/journals.ts`, `lib/deletions.ts`,
`lib/contacts/mail.ts` (four sends), `lib/digest/mail.ts` — passes a real
username and always did.

**"No branch escapes `contentRoot()`" was not true even with a username.**
`path.join(contentRoot(), mail.username, "mail")` produces whatever the username
says, and a username reaches the filesystem as a directory name — which AGENTS.md
already calls a security boundary. Nothing can reach it today; every caller has
been through `isValidUsername`. But the second acceptance line asks for a
property, not a habit, so `mailDir()` now asserts containment and throws rather
than writing outside the root.

## Work

Send signup mail to a directory that is inside the content root, and say where.

- Give the signup mail a home. It has no username by definition, so either
  `writeEml` grows an explicit "no journal" bucket under `contentRoot()` — say
  `content/.mail/` — or the signup route passes a reserved name. The first is
  better: the fallback is the thing that is wrong, and any future mail sent
  before a journal exists inherits the fix.
- Do not use `process.cwd()` for anything user-derived. It is the checkout in
  production and the repository in development, and the difference is exactly
  why this went unnoticed — locally the file appears next to the code the author
  is already looking at.
- Correct the location wherever B57 wrote it down: the config documentation,
  `AGENTS.md`, and B57's own security note if it is quoted anywhere.
- Remove the three files on the deployed server as part of shipping this.

Not doing: retention or automatic expiry of mail copies. That is a real gap and
it applies to every `.eml` the instance keeps, not just these — worth its own
task rather than being smuggled in here. Captured as **B130**, which also
records the consequence this change has for it: once mail is inside
`CONTENT_DIR` it is inside the backup, so never deleting it costs more than it
did. Nor is this a reason to reconsider `keepCopy`, which is doing what it was
asked to do.

### What was built

- **`lib/mail/index.ts`** — the fallback is gone. `writeEml` now asks a new
  `mailDir(username)`, which returns `content/<user>/mail/` or, with no
  username, `content/.mail/`. The leading dot follows `content/.deleted/`
  (`lib/tombstones.ts`): an instance directory rather than a person's, skipped
  silently by the journal scan in `lib/users.ts`, and impossible for a journal
  to collide with because `USERNAME_RE` admits no dot. `mailDir` then resolves
  the path and refuses anything outside the content root. The `keepsCopy()`
  security note names both directories. Two log lines that read
  `path.relative(process.cwd(), file)` now go through `displayPath()`, which
  falls back to the absolute path rather than printing
  `../../var/lib/fernscout/content/…` on a server.
- **`test/mail.test.ts`** — four tests: mail with no journal lands in
  `content/.mail/` and not under `process.cwd()`; every path the file transport
  produces is under the content root; a traversing username is refused rather
  than written; and a *kept copy* of journal-less mail lands in the same place.
- **`test/signup-mail.test.ts`** (new) — the same thing through the real
  `POST /api/auth/signup/request`, with the file transport, decoding the `.eml`
  far enough to see the six-digit code in it. The unit test only proves the
  fallback is right if something still takes that branch, and the whole defect
  was that nobody noticed which branch this endpoint was on.
- **Documentation** — `AGENTS.md` (the content-model tree gains `.mail/`, and
  the "no paid account" bullet says every path `lib/mail` writes is under
  `contentRoot()`); `docs/archiv/deploy-mail.md` (both the development and the
  `keepCopy` sections, plus a two-directory `rm` for clearing copies out, and
  signup codes added to the list of what `keepCopy` puts on disk);
  `docs/archiv/running-locally.md` ("where things are while it runs");
  `docs/archiv/qa/SCENARIOS.md` K1 and `docs/archiv/qa/BLACKBOX.md`, both of
  which said "every mail" and named one directory; `lib/auth/index.ts`'s module
  note. `docs/archiv/AGENTS.md` was left alone deliberately — its mention is a
  record of a path audit run on 2026-09-01, not a claim about where mail goes.
- **`.gitignore`** — `content/.mail/` added. `/mail` kept, and annotated as the
  old location: an existing checkout may still hold plaintext codes, and the
  ignore is what stops somebody committing them before they notice.

Two queued tasks touch this file and neither got easier or harder. **B50** (two
mails in the same millisecond overwrite each other) is about the filename, which
is untouched — though it now has one more directory to be true in. **B86** (a
non-ASCII recipient slugs to an empty filename) is about `slug()`, also
untouched. Whatever fixes them should do so inside `writeEml`, which is still
the single place a filename is chosen.

## Acceptance

- A signup code's `.eml` is written under the content root, not the working
  directory. A test asserts the path, since this is a behaviour no reader
  notices and no existing test covers.
- `contentRoot()` is the root of every path `writeEml` can produce — there is
  no branch that escapes it.
- The documented location matches every kind of mail, signup included.
- `/srv/fernscout/mail/` is empty on the deployed instance.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.

**The last-but-one line is the operator's, and no code change can satisfy it.**
The three files already on fernscout.ch are outside everything this branch
touches — a deploy will not remove them, because a deploy does not delete
untracked files in the checkout. They have to be deleted by hand on the box:

```bash
ls -la /srv/fernscout/mail/          # look before deleting
rm -rf /srv/fernscout/mail/
```

Nothing writes there any more, so it will not come back.
