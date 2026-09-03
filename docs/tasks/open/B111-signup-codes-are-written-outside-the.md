---
id: B111
title: Signup codes are written outside the content directory, where nobody is looking for them
type: ISSUE
priority: medium
complexity: low
area: mail, ops, security
found: "2026-09-03"
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
task rather than being smuggled in here. Nor is this a reason to reconsider
`keepCopy`, which is doing what it was asked to do.

## Acceptance

- A signup code's `.eml` is written under the content root, not the working
  directory. A test asserts the path, since this is a behaviour no reader
  notices and no existing test covers.
- `contentRoot()` is the root of every path `writeEml` can produce — there is
  no branch that escapes it.
- The documented location matches every kind of mail, signup included.
- `/srv/fernscout/mail/` is empty on the deployed instance.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
