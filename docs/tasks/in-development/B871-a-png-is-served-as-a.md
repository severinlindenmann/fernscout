---
id: B871
title: A PNG is served as a JPEG and nothing says so
type: DOCS
priority: low
complexity: low
area: docs, media
found: "2026-09-07T17:36:51Z"
started: "2026-09-08T05:05:25Z"
session: 41335894-5435-4167-8cb6-898e370cd6a9
claimed: "2026-09-08T05:05:25Z"
---

# B871 — A PNG is served as a JPEG and nothing says so

## Why

A PNG upload is transcoded and served as JPEG — the response even names the
file `01.jpg`. Nothing in `/agent.md`'s media section says so.

It is a defensible choice for photographs, and a surprising one for somebody
who chose PNG deliberately: a flat-colour graphic, a screenshot, a map, a scan.
JPEG re-encoding of flat colour introduces banding a photographer notices.

The section already says HEIC is fine; the conversion rule belongs beside it.

## Work

One sentence in the media section naming what is transcoded to what, and one on
whether the original PNG is kept for print (it is — `kept` reports the source
bytes).

## Acceptance

Somebody uploading a PNG knows before uploading what will be served.
