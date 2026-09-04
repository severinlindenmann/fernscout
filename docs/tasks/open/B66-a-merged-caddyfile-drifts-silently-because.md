---
id: B66
title: A merged Caddyfile drifts silently, because nothing checks the running config against what the release expects
type: CHORE
priority: medium
complexity: medium
area: deploy, caddy, docs
found: "2026-09-01"
---

# B66 — A merged Caddyfile drifts silently

## Why

B01 needed one line in the proxy — `header_up X-Forwarded-For {remote_host}` —
without which every rate limit on the server could be reset by forging a
header. The line went into `deploy/Caddyfile` with the rest of the fix, was
deployed, and **had no effect**, because nothing installs that file. It had to
be applied to `/etc/caddy/Caddyfile` by hand afterwards.

`deploy/Caddyfile` is not wrong about itself. Its first lines already say the
right thing:

> A reference snippet, not a file to copy blindly. On a VPS that serves nothing
> else, this can become `/etc/caddy/Caddyfile` outright. On a machine that
> already has one — another site, another service — **merge the site block
> below into the existing file instead.**

That instruction is correct and must not change. This instance is exactly the
second case: one Caddy serves `severin.io` and `fernscout.ch`, and
`cp deploy/Caddyfile /etc/caddy/Caddyfile` would delete a working site.

**The gap is what happens after the merge.** An operator merges once, on the
day they set the machine up. Every later change to the reference — a new
header, a cache rule, a security directive — silently fails to reach them, and
nothing anywhere says so. The next person to fix a proxy bug will fix the copy
that is not running, exactly as happened with B01, and the fix will look
deployed because the deploy succeeded.

Two files now claim to describe this machine's proxy and neither is
authoritative: the repo's, which is a template nobody runs, and `/etc/caddy`'s,
which nobody reviews.

## The principle this has to hold to

**The repository is the template.** Somebody clones it, follows the runbook,
and has a working instance — that is the promise, and a fix that only exists as
a paragraph telling them to go and edit a file by hand is a promise half kept.

**And it must never assume it owns the machine.** Adapting it to a VPS that
already hosts other things is the normal case, not the exception, and no step
may clobber somebody's existing site to make Fernscout's life easier. Anything
that rewrites `/etc/caddy/Caddyfile` wholesale is out, whatever it gains.

Those two pull against each other, which is why this is a design task and not a
one-line fix. `scripts/sync-shipped-content.sh` from B56 is the shape that
worked for the same tension in `content/`: it copies only the directories that
belong to the release, and refuses to touch anything else.

## Work

Sketch — the decision is which of these, not all of them.

- **Ship an importable snippet.** Caddy has `import`. A
  `deploy/fernscout.caddy` holding only the site block, installed to a known
  path, and an operator's own Caddyfile carrying one `import` line forever
  after. Greenfield users get the whole file; shared-host users get a file that
  updates itself and one line they never touch again. This is the option that
  makes the template promise true in both cases.
- **Or verify rather than install.** A deploy step, or `/api/health`, that
  states whether the running proxy actually overwrites `X-Forwarded-For` — the
  same trick the B01 acceptance used: send a request with a forged header and
  see which address the limiter counted. Cheaper, changes nothing on the
  machine, and turns a silent drift into a line in the deploy log. Weaker,
  because it reports rather than fixes.
- **Or both**, with the check as the backstop for operators who decline the
  import.

Whichever: the runbook has to say what an existing-Caddy operator does *on
every release*, not only on day one. Right now it tells them how to start and
not how to keep up.

Not doing: making `deploy.sh` write to `/etc/caddy` unprompted. It runs as the
service user, `/etc/caddy` is root's, and a deploy that edits another service's
config is exactly the behaviour the template promise forbids.

## Acceptance

- A clone-and-follow-the-runbook install ends with the proxy directives the
  release expects, without hand-editing.
- An install that shares Caddy with another site gets the same directives
  without that site being touched — verified by keeping a second site block in
  place across a release.
- A release that adds a proxy directive reaches an existing machine, or says
  loudly that it has not.
- `deploy/Caddyfile` and the machine's copy can be shown to agree, by a command
  written down in the runbook.

## Related

B01 is what exposed it. `scripts/sync-shipped-content.sh` (B56) is the
precedent for syncing part of a release into place without owning the
destination.
