---
id: B1402
title: "A content path one level too shallow is reported accurately and without naming the likely cause"
type: ISSUE
priority: low
complexity: low
area: fernscout-helper, validate skill
found: "2026-09-10T21:24:00Z"
---

# B1402 — A content path one level too shallow is reported accurately and without naming the likely cause

## Why

**The diff lands in `fernscout-helper`.**

Pointed at `content/` rather than `content/<user>/`, the client reported the
problem correctly — nothing was misstated — and stopped there. The one thing
it did not say is the thing that resolves it: everything a person owns lives
under `content/<username>/`, and a path one level up looks empty for exactly
that reason.

Cheap to fix and worth fixing because it is the first thing anybody does with a
fresh clone, and the correct-but-unhelpful error is the difference between
thirty seconds and a session spent doubting the checkout.

## Work

In `fernscout-helper`, where the content root is resolved: when the given path
has no journal in it but does contain directories that each look like one
(a `config.json`, a `trips/`), say so — *"`content/` holds journals; you
probably meant `content/severin/`"*, naming what was actually found.

Do not guess and proceed. Naming the likely path is help; picking one silently
is the class of thing that goes wrong on the machine where there are two.

## Acceptance

- Running the validator against `content/` names the journal directories it
  found and the path that was probably meant.
- Running it against a genuinely empty directory still says what it says today.
