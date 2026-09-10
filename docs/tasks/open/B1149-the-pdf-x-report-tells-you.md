---
id: B1149
title: The PDF/X report tells you to run gs-pdfx.sh, which is only written when the run already had an ICC
type: ISSUE
priority: low
complexity: low
area: photobook, print
found: "2026-09-09T18:38:34Z"
---

# B1149 — The PDF/X report tells you to run gs-pdfx.sh, which is only written when the run already had an ICC

Found during B108, on fernscout.ch on 2026-09-09.

## Why

Generate a book without `--icc` and the readiness report ends
(`lib/photobook/pdfx.ts:305-309`):

> This file declares no PDF/X version, because it does not meet one. Run the
> Ghostscript command in gs-pdfx.sh to produce one that does.

`gs-pdfx.sh` is written at `scripts/photobook.ts:321-341`, inside
`if (iccPath) { … }`.

So the file is produced only when an ICC profile was supplied — and the message
pointing at it appears only when one was not, because a missing output intent
is the single requirement that fails. The advice is circular: it fires exactly
in the case where the thing it names does not exist.

Confirmed on the deployed instance. The run wrote nine files; `gs-pdfx.sh` was
not among them, and the report told the reader to run it anyway.

The report is otherwise excellent and honest — every other box it ticks is
true of the actual PDF (checked independently: 50 pages, TrimBox and BleedBox
present, three embedded font programs, 43 embedded JPEGs, no `OutputIntent`, no
`GTS_PDFXVersion`). This one sentence is the only part that misleads, and it
misleads a person who is trying to do the right thing about colour.

## Work

The lazy fix is to make the sentence conditional on the file existing, and to
say what to do when it does not — supply `--icc <profile.icc>`, which the
report already says two paragraphs earlier in the requirement's own detail.

The alternative is to write `gs-pdfx.sh` unconditionally with the ICC path left
as a placeholder the reader fills in. Probably worse: a script that cannot run
as printed is what the comment at `scripts/photobook.ts:319` ("written out so
it is runnable as printed") exists to avoid.

`readinessReport()` does not currently know whether the script was written, so
it needs telling — one boolean.

## Acceptance

- `npm run photobook -- --trip <ref>` with no `--icc`: the report does not name
  a file the run did not write.
- The same with `--icc`: it does, and the file is there.
