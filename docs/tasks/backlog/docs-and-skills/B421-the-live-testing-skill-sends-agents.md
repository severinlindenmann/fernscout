---
id: B421
title: The live-testing skill sends agents to a mail directory that does not exist on the server
type: DOCS
priority: low
complexity: low
area: skills, testing
found: "2026-09-05T11:05:00Z"
---

# B421 — The live-testing skill sends agents to a mail directory that does not exist on the server

## Why

`.claude/skills/test-the-live-site/SKILL.md`, under "Reading a code, a link, or
any mail":

> - **Signup** codes, which have no journal yet → `/srv/fernscout/mail/`

There is no such directory on the host:

```
$ ssh 95.216.112.173 'sudo ls /srv/fernscout/mail/'
ls: cannot access '/srv/fernscout/mail/': No such file or directory
```

Signup mail lands in `/var/lib/fernscout/content/.mail/`, which is what
`AGENTS.md` describes ("`content/.mail/` — mail that belongs to no journal
yet") once you know that `CONTENT_DIR=/var/lib/fernscout/content` on this
instance. `/srv/fernscout` is the code checkout; its own `content/` is the
repo's, which the server does not read.

Cost is an agent's first ten minutes: the `ls` succeeds against the *journal*
mail path in the same command, so the empty result reads as "no mail arrived"
rather than "wrong directory", and the natural next step is to re-request a
code and burn one of five per hour.

The journal-mail line beside it has the same shape and is right in form but
also relative — worth stating both as `$CONTENT_DIR/...` with the one line
saying where `CONTENT_DIR` points on this host.

## Work

Correct the two paths in `SKILL.md`, and say that `CONTENT_DIR` is what
decides them — an instance that puts its content elsewhere moves both.

While there: the skill's example pipes `ssh … | grep -E '^[A-Za-z0-9+/=]{40,}'`
without `sudo`, and the mail files on this host are not world-readable. The
working form is `ssh <host> "sudo cat $D/\$(sudo ls -t $D | head -1)"`.

## Acceptance

A fresh agent following the skill reads a signup code on the first attempt,
with no `No such file or directory` and no wasted code request.
