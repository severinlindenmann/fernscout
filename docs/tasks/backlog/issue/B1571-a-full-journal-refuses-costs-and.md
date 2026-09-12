---
id: B1571
title: A full journal refuses costs and contacts imports though those kinds write nothing
type: ISSUE
priority: low
complexity: low
area: import
found: "2026-09-12T08:55:00Z"
---

# B1571 — A full journal refuses costs and contacts imports though those kinds write nothing

## Why

`app/api/v1/[user]/import/route.ts` runs a blanket `storageRefusal()` before
branching on `kind`, so a journal at its storage ceiling is refused a `costs`
or `contacts` import — but those kinds write nothing to disk (`costs` only
reports; `contacts` matches rows). The refusal advises buying storage for an
operation that needs none. Pre-existing behaviour, noticed during B1556.

## Work

Skip the quota check for kinds that write nothing, or move it after the
kind branch so only writing kinds pay it.

## Acceptance

A journal over its ceiling can still run a `costs` dry-run import; a `gps`
import is still refused.
