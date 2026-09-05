---
id: B475
title: The nightly status mail is a wall of monospace while every other letter this instance sends is designed
type: FEATURE
priority: low
complexity: medium
area: backups
found: "2026-09-05T13:48:25Z"
started: "2026-09-05T13:48:45Z"
session: 7c3dd4ae-2d91-4172-8ea8-52deb35f9f42
claimed: "2026-09-05T13:48:45Z"
---

# B475 — The nightly status mail is a wall of monospace while every other letter this instance sends is designed

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Asked for: *"make the email visually more pleasing, a bit html formatting or
something"*.

`scripts/alert.mts:141` is the whole of the current design:

```ts
const html = `<pre style="font:14px/1.5 ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`;
```

Every other letter this instance sends — a sign-in code, a deletion
confirmation, an invitation, a postcard receipt — goes through
`renderMail()` in `lib/mail/template.ts`: cream paper, the ink and accent
colours, a 560px column, a footer. The one letter the operator reads every
morning is the one that does not.

The column widths are also padded to a monospace grid, which a proportional
mail client throws away and a phone wraps mid-row.

## Work

The pipe is the thing to remove first. `scripts/alert.sh` shells out to
`npm run status`, captures its **prose**, and hands it to `scripts/alert.mts`,
which wraps that prose in `<pre>`. Nothing downstream can lay out a table it
was given as pre-formatted text, so:

1. `lib/statusReport.ts` — `collectStatus()` returning the data, and
   `statusText()` rendering the plain-text version. The counting logic moves
   here from `scripts/status.mts`, which becomes a thin CLI over it.
2. `scripts/alert.mts` calls `collectStatus()` itself on the success path.
   No subprocess, no npm inside npm, and — since B468 — nothing is counted at
   all when the report is going to be withheld. Today that work is done and
   then thrown away.
3. Two new `MailBlock` kinds in `lib/mail/template.ts`: `table` for the
   roster, `code` for the journal tail a failure carries. Both are needed by
   this letter and neither exists; `code` also replaces the raw `<pre>` above.
4. The mail goes through `renderMail()` like every other letter.

**The plain-text part stays a real plain-text part.** It is what lands in a
terminal mail client and in `journalctl`, and `statusText()` is also what
`npm run status` prints, so it cannot become a stub.

Not doing: colour-coding numbers, charts, a logo, or a per-journal link. The
ask was legibility.

## Acceptance

The success mail renders as a table on cream with the site name at the top, in
a mail client and in a browser. `npm run status` prints what it prints today.
A failure mail still shows its journal tail, monospaced, and still reaches the
fallback address. `scripts/alert.sh` no longer runs `npm run status`.
