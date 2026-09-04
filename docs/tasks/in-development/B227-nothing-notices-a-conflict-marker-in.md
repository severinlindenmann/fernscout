---
id: B227
title: Nothing notices a conflict marker in deploy/Caddyfile, because every check greps for a line rather than parsing the file
type: ISSUE
priority: medium
complexity: low
area: tests, deploy, caddy
found: "2026-09-04T07:47:58Z"
started: "2026-09-04T08:08:59Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T08:08:59Z"
---

# B227 — Nothing notices a conflict marker in deploy/Caddyfile

## Why

Commit `4705300` (the G11 merge) committed `deploy/Caddyfile` with conflict
markers in it — `<<<<<<< HEAD` at line 42, `=======` at 74,
`>>>>>>> g11-backup-systemd-and-tests` at 80 — and the whole suite stayed
green. A person found it by eye and resolved it by hand in `b5e6f7d`.

The file is a Caddy config. With markers in it, it is not one:

```
$ caddy adapt --config <the file at 4705300> --adapter caddyfile
Error: unrecognized directive: fernscout.invalid   (exit 1)
```

Three checks look at these files and not one of them would have said so:

- **`test/client-ip.test.ts:79`** asserts `deploy/Caddyfile` against
  `/^import\s+\S*deploy\/fernscout\.caddy$/m`. The import line survived inside
  the g11 half of the conflict, so the regex matched — confirmed against the
  committed blob. A line-anchored regex asks whether one string is *somewhere*
  in the file; it cannot ask whether the file is a file.
- **`test/client-ip.test.ts:66,72`** guard `deploy/fernscout.caddy` the same
  way — a `header_up` regex and a `reverse_proxy` block regex. Same shape, same
  blindness.
- **`test/check-caddy.test.ts`'s adapting keeper** — the one check in the repo
  that runs a parser — is `test.skipIf(!HAS_CADDY)`, and `.github/workflows/ci.yml`
  installs no Caddy. It runs on a maintainer's laptop and nowhere else. That is
  **B226**, one lane over, and this task is what that hole costs.

`npm run check:caddy` does parse, but it is not this: it defaults to
`/etc/caddy/Caddyfile` (`scripts/check-caddy.mts:192`) and asks whether the
*running* machine has drifted from the shipped snippet. It never reads
`deploy/Caddyfile` at all.

What it costs. Caddy is a single-config-file server and an unparseable config
is a refused reload, so the marker had two ways to reach a machine: the
greenfield path in the file's own header (`cp deploy/Caddyfile
/etc/caddy/Caddyfile`) leaves a VPS with no proxy, and on a merged machine the
`import` makes the broken file everyone else's problem too. It sat on `main`
in the meantime, where the next merge would have carried it further. This is
the same family as **B01** and **B66**: the deploy files are the part of the
system the test suite believes rather than reads.

There is a real obstacle, and it is why nobody wired a parse up. Adapting the
repo's own `deploy/Caddyfile` fails for an unrelated reason — its last line is
`import /srv/fernscout/deploy/fernscout.caddy`, an absolute path that does not
exist on a checkout or in CI, and Caddy stops there:

```
Error: File to import not found: /srv/fernscout/deploy/fernscout.caddy, at …:79
```

So "run `caddy adapt` on it" is not a one-liner, and any fix has to say what it
does about that path.

## Work

- Decide what guards these files, given that the honest parser needs a binary
  CI does not have and an import path that only resolves on the VPS. Candidates,
  and they are not exclusive:
  - A cheap, always-running assertion that no tracked file carries a conflict
    marker. Catches this class everywhere, not just in `deploy/`, costs no
    binary, and is the one that would have caught `4705300`. Note the marker
    strings have to be built rather than written literally, or the test file
    fails itself.
  - Make the real parse runnable: install Caddy in CI (that is B226's half),
    and give the adapt a resolvable import — a temporary copy with the path
    rewritten, or a `{$FERNSCOUT_CADDY}` placeholder the check substitutes.
- Whatever lands, `test/client-ip.test.ts`'s three regex assertions stay. They
  assert *content* and are correct at that job; the gap is that nothing asserts
  *shape*. Say so in the file so the next reader does not delete one for the
  other.
- Coordinate with **B226** rather than duplicating it: that task is about the
  two skipped keepers, this one is about the file they were meant to keep.

Not doing: moving or flattening the `import`. B66 made that indirection
load-bearing — a proxy change reaches the machine with the commit that made it —
and a test's convenience is not a reason to undo it.

## Acceptance

- Restoring `deploy/Caddyfile` to its state at `4705300` makes a check fail,
  and the failure names the file and says a conflict marker is in it.
- The check runs on `ubuntu-latest` in `.github/workflows/ci.yml` with no
  manual step, and on macOS, and its result does not depend on whether a
  `caddy` binary is present — or, if it does, the file says which half is the
  keeper and B226 carries the binary.
- `npx vitest run` still passes on a clean checkout.
