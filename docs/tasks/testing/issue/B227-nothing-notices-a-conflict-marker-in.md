---
id: B227
title: Nothing notices a conflict marker in deploy/Caddyfile, because every check greps for a line rather than parsing the file
type: ISSUE
priority: medium
complexity: low
area: tests, deploy, caddy
found: "2026-09-04T07:47:58Z"
started: "2026-09-04T08:08:59Z"
merged: "2026-09-04T08:26:56Z"
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

The Why was verified rather than trusted: `git show 4705300:deploy/Caddyfile`
still has the three markers at lines 42, 74 and 80, the `import` line does
survive inside the second half, and `caddy adapt` on it fails with
`unrecognized directive: journal.example`. All of it holds.

**Both halves landed, and the file says which is the keeper.**

**The keeper — `test/conflict-markers.test.ts`.** No tracked file carries a
conflict marker. `git ls-files`, skip anything with a NUL byte in its first 8 KB,
and report `file:line` for every marker. It needs no binary, runs wherever
`npx vitest run` does — so on `ubuntu-latest` in the existing `test` job with no
new step, and on macOS — and it catches the class in every file rather than in
the one that happened to break this time. 51 ms over 992 tracked files.

Two details that decide whether it is usable:

- **The marker strings are built, not written** (`"<".repeat(7)`), or the test
  file would be a tracked file carrying a conflict marker and would fail itself.
- **`<<<<<<<` and `>>>>>>>` are conclusive on their own; `=======` and `|||||||`
  are only counted in a file that already has one of those.** Seven `=` at the
  start of a line is a valid Markdown setext heading underline, and this
  repository is mostly Markdown. A real conflict always has all three markers,
  so requiring the company of an opening or closing one costs nothing and stops
  an ordinary document from failing the build. A marker indented by a space, or
  quoted inline in prose, is not reported — which is what lets a task file
  (including this one) describe the problem.

  Checked against the tree as it stands: zero matches for any of the four forms,
  so nothing had to be exempted. `docs/tasks/` is **not** excluded.

**The expensive half — `test/check-caddy.test.ts`.** `deploy/Caddyfile` is now
adapted through `caddy adapt`, which is a real parse. The obstacle the Why
identified is handled the way it suggested: the file is copied to a temp
directory with its one `import /srv/fernscout/deploy/fernscout.caddy` line
repointed at this checkout, and nothing else is rewritten. `CADDY_ACME_EMAIL`
has to be set too — an unset variable adapts to nothing and `email` refuses a
missing argument, which is a second reason nobody had wired this up. It is
`test.skipIf(!HAS_CADDY)`, so it skips exactly where the marker would have
reached `main`; **B226** carries the binary, and when it lands this becomes the
stronger of the two. The test file says all of that.

`test/client-ip.test.ts`'s three regex assertions stay, untouched, and its
header now says why: they assert *content* and are right at that job, the gap
was that nothing asserted *shape*, and neither check replaces the other.

Not doing: moving or flattening the `import`. B66 made that indirection
load-bearing — a proxy change reaches the machine with the commit that made it —
and a test's convenience is not a reason to undo it.

## Acceptance

- **Restoring `deploy/Caddyfile` to its state at `4705300` makes a check fail,
  and the failure names the file and says a conflict marker is in it.**
  Demonstrated:

  ```
  AssertionError: unresolved merge conflict:
    deploy/Caddyfile:42 begins with a <<<<<<< conflict marker
    deploy/Caddyfile:74 begins with a ======= conflict marker
    deploy/Caddyfile:80 begins with a >>>>>>> conflict marker
  ```

  Three tests go red, not one: the repository-wide sweep, the by-name
  `deploy/Caddyfile is free of conflict markers`, and — where Caddy is
  installed — `adapts cleanly with that import pointed at this checkout`, which
  fails with `unrecognized directive: journal.example`.

- **The check runs on `ubuntu-latest` in `.github/workflows/ci.yml` with no
  manual step, and on macOS, and does not depend on a `caddy` binary.** The
  keeper is plain vitest, so the existing `test` job runs it as-is; no workflow
  change was needed. The half that does need the binary is named above as the
  half that skips, and B226 carries it.

- **`npx vitest run` still passes on a clean checkout.** It does.

The detector is additionally exercised against a reconstruction of
`deploy/Caddyfile` as it was at `4705300` — rebuilt in the test rather than read
from git history, because `actions/checkout@v4` clones at depth 1 and
`git show 4705300:…` would not resolve in CI.
