---
id: B218
title: A postcard run reports three files per recipient and writes four
type: ISSUE
priority: low
complexity: low
area: postcards, scripts
found: "2026-09-04T06:40:11Z"
started: "2026-09-04T08:08:59Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T08:08:59Z"
---

# B218 — A postcard run reports three files per recipient and writes four

## Why

Noticed while building **B150**, and deliberately not absorbed into it.

`scripts/postcard.ts` writes four files for every recipient — `<base>.pdf`,
`-front.pdf`, `-back.pdf` and `-stannp-request.json` — and then says:

```
Wrote 12 file(s) to content/example/postcards/
```

for a batch of four. The count is `recipients.length * 3` and has been since
the request JSON was added beside the PDFs. `ls` shows sixteen.

Small, and worth saying how small: nothing is lost and nothing is misfiled.
The cost is that the one line a person uses to check a run against the folder
they are about to hand to a printer does not match the folder, which is the
one job that line has. It is also the line somebody would check first if a
card really were missing — which is the failure B86 and B150 both describe.

Confirmed before changing anything: a batch of four reported `Wrote 12
file(s)` and `ls` found sixteen.

## Work

Count what was written rather than multiplying, so the number cannot drift
again the next time a file joins the set. **Done:** `scripts/postcard.ts` now
writes through a small `write()` that appends to a `written[]`, the way
`scripts/photobook.ts` already did, and the report is `written.length`.

Fixed alongside **B219**, which moved the same script's output directory.
They share a commit rather than splitting one: the two changes are twenty
lines apart in `scripts/postcard.ts`, and the same test file covers both.

## Acceptance

- A run of N recipients reports the number of files `ls` finds in the output
  folder for that run.

`test/generator-output.test.ts` asserts it twice, and deliberately: once with
`CONTENT_DIR` pointing outside the checkout, and once with the two roots
agreeing, so this stays guarded even if B219's fix were ever undone.
