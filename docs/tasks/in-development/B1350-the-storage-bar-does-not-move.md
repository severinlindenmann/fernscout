---
id: B1350
title: The storage bar does not move when an upload lands
type: ISSUE
priority: high
complexity: low
area: helper
found: "2026-09-10T17:35:31Z"
started: "2026-09-10T17:35:41Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T17:35:41Z"
---

# B1350 — The storage bar does not move when an upload lands

## Why

`StorageLine` fetched the account once on mount, so an upload that landed
did not move the bar (owner's screenshot: 0.38 GB unchanged after
uploading).

## Work

The fetch effect depends on the inbox count as well as the username: an
upload that lands in the pane re-reads the storage numbers.

## Acceptance

Upload a photo in the files pane; the storage line under it re-fetches
and the fill moves without a reload.
