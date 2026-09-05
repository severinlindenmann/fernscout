---
id: B475
title: The nightly status mail is a wall of monospace while every other letter this instance sends is designed
type: FEATURE
priority: low
complexity: medium
area: backups
found: "2026-09-05T13:48:25Z"
started: "2026-09-05T13:48:45Z"
merged: "2026-09-05T14:08:54Z"
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

## What was built

The pipe went first, and everything else followed from that.

`lib/statusReport.ts` holds the counting and both renderings.
`scripts/status.mts` is now nine lines over it. `scripts/alert.mts` calls
`collectStatus()` in its own process — so `scripts/alert.sh` runs no
subprocess on the success path at all, and nothing is counted when B468 is
going to withhold the report anyway. That last part used to walk every journal
and every byte to build something it then dropped.

Two new `MailBlock` kinds, `code` and `table`, and the letter goes through
`renderMail()` like the other five. Cream paper, ink, the 560px column.

**Three decisions inside the layout:**

- **The `<h1>` is not the subject line.** It was `[Fernscout]
  fernscout-backup.service succeeded`, brackets and all — a mail shouting its
  own inbox filing label at its reader. It is "The backup finished cleanly"
  now, with the unit, host and time as the paragraph under it.
- **Minute precision, and a space instead of the `T`.** A full ISO instant is
  24 characters of unbroken punctuation, and a 560px column wraps it in the
  middle. Nobody reading a backup mail wants the milliseconds.
- **Both new blocks scroll inside a single-cell `table-layout:fixed` table.**
  `overflow-x:auto` alone contains nothing in a table cell: a `<td>` grows to
  its content's min-content width, fixed-width text does not wrap, and one long
  log line was widening the whole letter so the *body* scrolled sideways. The
  fix is contained in the two blocks rather than put on the letter's own
  column, because five other letters render through that table and none of them
  needed changing.

## Evidence

Rendered to PNG through headless Chrome at 680px and at 420px, both outcomes.
The phone-width failure mail is what caught the scrolling bug — the opening
paragraph was being clipped rather than wrapped, which is the body being wider
than the viewport.

- `test/mail.test.ts` — a table is a real `<table>` in HTML with the note on a
  `colspan` row, and a padded grid in text whose right edges line up across
  header and rows; a code block keeps `white-space:pre` and carries the
  scroller; neither can break out of the HTML.
- `test/backup-script.test.ts` — a stub `npm` that shouts if anything asks it
  for the status report proves `alert.sh` no longer shells out, and that a
  success pipes nothing while a failure pipes its journal.
- `test/alert-script.test.ts` — the roster now comes from `CONTENT_DIR` in the
  alert's own process, and is still withheld from a non-operator address.
- `npm run status` prints exactly what it printed before the refactor.
- `npm run unused` clean; `formatBytes` and `statusTotal` unexported rather
  than left as API nothing imports.
