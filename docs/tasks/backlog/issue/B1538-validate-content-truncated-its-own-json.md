---
id: B1538
title: validate-content truncated its own JSON report, and selftest blamed the fixture
type: ISSUE
priority: medium
complexity: low
area: helper, tests
found: "2026-09-11T21:35:00Z"
---

# B1538 — validate-content truncated its own JSON report, and selftest blamed the fixture

## Status — fixed in fernscout-helper

**Fixed and committed** on 2026-09-11: `validate.mjs` sets
`process.exitCode` instead of calling `process.exit()`. `selftest.mjs` is green
again, and both exit codes are unchanged — 1 with errors, 0 without.

Filed after the fact because nothing recorded it and the next person to meet it
would have started where I did: suspecting the fixture.

## Why

`node .claude/skills/shared/selftest.mjs` reported:

```
✗ luecken: the validator did not answer with JSON
1 fixture did not say what it should.
```

The message points at the fixture, and the file's own help text points further
that way — *"Usually this means the instance has learned a field these tools have
not."* Both are wrong here, and the fixture was fine.

`validate.mjs` ended with `process.exit(counts.error ? 1 : 0)`. When stdout is a
**pipe** — which it is for every caller that reads `--json`, `selftest.mjs`
included — writes to it are asynchronous, and `process.exit()` tears the process
down with the tail still unwritten. The `luecken` report is 86'123 bytes and
arrived as **65'302**: perfectly well-formed JSON ending in the middle of a
string, at the pipe's capacity.

Two things made this expensive to find:

- **It only happens on the error path.** `perfekt` and `halbfertig` exit 0 and
  came back whole, so four of five checks passed and the one that failed was the
  one with a deliberately broken fixture. Every signal pointed at the fixture.
- **The report grew into it.** The truncation appears once the output crosses the
  pipe buffer, and the output is mostly the instance's own explanations of unset
  fields — text the instance is free to lengthen at any time. So this was latent
  and arrived without anything in either repository changing.

My own first diagnosis was wrong too: I set `maxBuffer` on the `execFileSync`
call, which does nothing at 86 KB, and reverted it.

## Work

Done, but worth a sweep: `process.exit()` after writing to stdout is the same
bug anywhere it appears. `grep -rn 'process.exit(' .claude/skills/` in
`fernscout-helper` finds the others — two more in `validate.mjs` itself, on
paths that print a line before exiting.

Also worth considering: `selftest.mjs`'s failure message states a cause it cannot
know. *"the validator did not answer with JSON"* is what it observed;
*"usually this means the instance has learned a field"* is a guess, and it sent
me down the wrong path first. Printing the first and last 80 characters of what
it got would have made the truncation obvious at once.

## Acceptance

- A `--json` report of any size survives being piped, on both exit paths.
- `selftest.mjs` is green.
- The exit code still distinguishes errors from none.
- No other `process.exit()` in the helper races a pending stdout write.
