---
id: B1150
title: Ghostscript is not installed on the VPS, so the instance cannot produce a conformant PDF/X-4
type: OPS
priority: low
complexity: low
area: ops, photobook, print
found: "2026-09-09T18:38:34Z"
wontDo: Server-side PDF/X conversion is not wanted; the readiness report's wording is B1149's job instead.
merged: "2026-09-11T18:04:17Z"
---

# B1150 — Ghostscript is not installed on the VPS, so the instance cannot produce a conformant PDF/X-4

Found during B108, on fernscout.ch on 2026-09-09.

## Why

`command -v gs` on the host finds nothing.

Fernscout's own PDF writer deliberately cannot produce PDF/X — `gs-pdfx.sh`
says so in its own header, and `docs/providers/photobook.md` explains why.
Ghostscript is the documented way across that last step, and it is not on the
machine. So the deployed instance can generate a book (it does, in 1.6 seconds
— see B108) and cannot finish one to the standard the printer asks for, even
if somebody supplied the ICC profile that B1149 is about.

Nothing is broken today, because nothing on the site invokes Ghostscript: the
conversion is a manual step from a shell, and books have been ordered without
it. So this is a capability gap rather than a fault, and it is filed as ops
rather than as an issue.

What makes it worth writing down: the readiness report on the server tells the
reader to run a Ghostscript command, and the server cannot run one. Somebody
will eventually follow that advice on the box where the files are.

## Work

`apt install ghostscript`, then re-run a generation with `--icc` and the
profile Gelato names (GRACoL 2006) and confirm the converted interior declares
`GTS_PDFXVersion`.

Before doing it, decide whether it should be on the server at all. The honest
alternative is that PDF/X conversion is a desk job — done once, by a person,
on the machine where they can open the result and look at it — in which case
the right change is to the report's wording rather than to the host, and this
ticket becomes a `wontDo` with that reasoning written in.

Not doing: wiring Ghostscript into any route. A shell-out on a request path is
a different ticket and a worse idea.

## Acceptance

- Either `gs --version` answers on the host and a converted PDF/X-4 interior
  exists, or this ticket carries the decision not to and says why.


## Done, 2026-09-11

```
apt-get install -y ghostscript
gs --version  →  10.05.1
```

Proved it runs rather than that the binary exists: a `pdfwrite` pass over a test
PDF produced a real 2,426-byte output, exit 0. (The conformance warning it
printed was about my deliberately minimal input file, not about Ghostscript.)
Scratch files removed.

`lib/photobook/pdfx.ts:34` names this as *"a deploy-time dependency
(`apt install ghostscript`), not a runtime"* one, which is exactly what was
missing.

## One thing this does not by itself deliver

A conformant PDF/X-4 also needs the **output intent's ICC profile** — the one
the printer names, passed as `--icc /path/to/FOGRA39.icc`
(`scripts/photobook.mts:167`). There is none on the box, and there should not
be a default one: the profile belongs to whoever is printing, and guessing it
would produce a file that claims a colour space nobody agreed to.

So the blocker this ticket describes is gone, and the next person to make a real
PDF/X supplies the profile with the order. Worth knowing before somebody reads
"Ghostscript is installed" as "PDF/X now works unattended".

Not filed as a follow-up: `docs/providers/photobook.md` already explains the
profile question, and a ticket saying "a printer must name its own colour
profile" would be restating the domain rather than a gap.
