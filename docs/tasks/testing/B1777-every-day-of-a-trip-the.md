---
id: B1777
title: Every day of a trip the instance does not hold yet is reported as unknown_trip, drowning the real errors
type: ISSUE
priority: low
complexity: low
area: fernscout-helper validate-content
found: "2026-09-15T06:24:45Z"
started: "2026-09-15T06:39:58Z"
merged: "2026-09-15T07:09:16Z"
---

# B1777 — Every day of a trip the instance does not hold yet is reported as unknown_trip, drowning the real errors

## Why

`validate-content` dry-runs the trip document and then dry-runs every day of
that trip regardless of what the trip's own answer was. `askTheInstance()`
returns nothing, so when a trip does not exist on the instance yet each of its
days is asked about separately and each comes back `404 unknown_trip`.

On a first run over a journal that has never been published that is the whole
output: 145 days reported as `unknown_trip`, with the 26 real trip-level errors
somewhere in the middle of it. The information is correct and useless.

## Work

Let `askTheInstance()` say what happened, and skip a trip's days when the trip
itself is not there — once, with one line saying the days were not checked
because the instance does not hold the trip yet. A trip that exists and is
refused for a content reason still has its days checked; that refusal is about
the document, not about the address.

## Acceptance

Validating a journal the instance has never seen prints one line per trip and
no per-day `unknown_trip`, and the trip-level errors are the whole of the
output.

## Built, 2026-09-15 — fernscout-helper `aa69dbd`

**Valid when taken**: `askTheInstance()` returned nothing, so every day was
asked about regardless of what the trip's own answer had been.

It returns the verdict now, and a trip whose own dry run answered 404 has its
days skipped with one line saying how many were not checked and why. A trip
that exists and is refused for a content reason still has every day checked —
that refusal is about the document, not the address.
