---
id: B761
title: A statement with a preamble line takes the wrong row as its header
type: ISSUE
priority: low
complexity: low
area: importers
found: "2026-09-07T13:57:57Z"
started: "2026-09-08T21:02:11Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T21:02:11Z"
---

# B761 — A statement with a preamble line takes the wrong row as its header

## Why

`importers/costs/mapping.ts:113` takes the first line with three or more cells
as the header row. Plenty of banks put a preamble above it — an account name, a
date range, an export timestamp — and a preamble line that happens to contain
two commas is taken as the header.

The person then sees nonsense column names in the picker, with no explanation
and no way to say "that is not the header". The model is shown the wrong header
too, so its mapping is wrong for a reason nobody can see.

Found while building B689.

## Work

An escape hatch on the screen — "that is not the header row" — that moves the
guess down a line. Cheaper than trying to be cleverer about detection.

## Acceptance

A statement with a two-line preamble can be imported without editing the file
first.
