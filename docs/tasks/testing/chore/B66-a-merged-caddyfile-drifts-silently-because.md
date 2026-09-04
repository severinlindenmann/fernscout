---
id: B66
title: A merged Caddyfile drifts silently, because nothing checks the running config against what the release expects
type: CHORE
priority: medium
complexity: medium
area: deploy, caddy, docs
found: "2026-09-01"
started: "2026-09-04T07:17:29Z"
merged: "2026-09-04T07:49:24Z"
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

## What was built

**Both** of the sketched options, because they answer different halves.

**1. An importable snippet — `deploy/fernscout.caddy`.** The site block alone,
no global options block, and it is *imported from the checkout* rather than
copied anywhere:

```
# one line, once, in /etc/caddy/Caddyfile
import /srv/fernscout/deploy/fernscout.caddy
```

That is the decision worth recording. Installing a copy to `/etc/caddy/` would
have needed a root write on every release and reintroduced the drift between
releases; importing the file *inside the checkout* means `git pull` — which is
to say every deploy — updates the proxy config, on a shared host, with nothing
writing to `/etc/caddy` at all. `deploy/Caddyfile` keeps its role for a
greenfield machine and is now the global options block plus that import.

The snippet also takes the port from `{$PORT:3000}`, which deletes the one
hand-edit the runbook used to require of an operator who moved the app off
3000.

**2. The check — `scripts/check-caddy.mts` / `npm run check:caddy`.** It adapts
both `/etc/caddy/Caddyfile` and `deploy/fernscout.caddy` through `caddy adapt`
and reports every handler the release expects that the running config does not
carry. Comparison is a one-directional subset over Caddy's own JSON: extra
directives on the machine — the neighbouring site's, or the operator's own —
are not drift, and only ours going missing is. Exit 0 agrees, 1 drifted, 2 the
question could not be asked (no Caddy on this machine is a supported
deployment and must not be nagged). `scripts/deploy.sh` runs it at the end of
every deploy, never fatally.

**Docs.** `docs/runbook.md` §7 and the shared-Caddy section now say what an
operator does *on every release* — nothing, if they took the import — plus the
`systemctl edit caddy` drop-in that supplies `CADDY_DOMAIN` and
`CADDY_ACME_EMAIL` without editing a file the next `git pull` will overwrite.

**A defect found and fixed in passing:** the runbook's own shared-Caddy snippet
told operators to paste `reverse_proxy 127.0.0.1:3000` **without**
`header_up X-Forwarded-For` — B01's fix, missing from the instructions for the
exact deployment shape B01 happened on. It is gone, replaced by the import.

## Evidence

- `test/check-caddy.test.ts`, 10 tests, all running on a machine with no Caddy
  installed: the comparator against committed `caddy adapt` output for three
  fixture Caddyfiles (`merged-ok`, `merged-drifted`, `imported`), the CLI's
  three exit codes, and `isSubset`'s edges.
- The drifted fixture is the B01 state exactly — the block present, the site
  working, `header_up` absent — and the check names it:

```
$ npm run check:caddy -- --config test/fixtures/caddy/merged-drifted.Caddyfile
WARNING: the proxy config is not what this release expects. Missing from …
  - reverse_proxy to 127.0.0.1:3000 setting X-Forwarded-For upstream
…
  import …/deploy/fernscout.caddy
exit=1

$ npm run check:caddy -- --config test/fixtures/caddy/imported.Caddyfile
caddy: the running config carries what this release expects
exit=0
```

  Both of those are real `caddy adapt` runs on both sides, on a machine with
  Caddy 2 installed.
- Acceptance line 2 (a shared host keeps its other site) is asserted directly:
  the `imported` fixture serves a second site block, nothing is missing, and
  the neighbour's handler is still in the running config.
- Acceptance line 3 (a release that adds a directive reaches an existing
  machine, or says so) is asserted by adding a header to the expectation and
  requiring the hand-merged machine to report it missing.
- Committed adapter output is kept honest by a keeper test that re-adapts the
  fixtures wherever Caddy exists and requires the result to match
  (`UPDATE_CADDY_FIXTURES=1` rewrites them). That one skips on CI.
- `test/client-ip.test.ts` — B01's own proxy assertions now read
  `deploy/fernscout.caddy`, plus a new one requiring `deploy/Caddyfile` to
  still import it, so the greenfield path cannot lose the site block.

## What still needs the operator and the VPS

All of it, at the end, because the running proxy is the only thing that can
answer:

- **fernscout.ch's `/etc/caddy/Caddyfile` has not been touched.** It still
  carries a hand-merged block. Replacing it with
  `import /srv/fernscout/deploy/fernscout.caddy` (after
  `sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%F)`,
  `sudo caddy validate`, `sudo systemctl reload caddy`) is the step that makes
  the drift stop happening rather than merely be reported.
- The `CADDY_DOMAIN` / `CADDY_ACME_EMAIL` drop-in has to exist before that
  reload, or Caddy adapts an empty site address.
- `npm run check:caddy` on the machine, before and after: it should say
  `header_up X-Forwarded-For` is missing beforehand — that is the live
  confirmation this ticket is right about fernscout.ch — and agree afterwards.
- Acceptance line 1, a clone-and-follow-the-runbook install, is a fresh VPS and
  has not been rehearsed.
