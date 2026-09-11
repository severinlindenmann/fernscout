---
id: B1248
title: The health endpoint reports content ok without ever checking the content root is writable
type: ISSUE
priority: medium
complexity: low
area: ops, health
found: "2026-09-10T09:15:00Z"
started: "2026-09-11T15:47:55Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T15:47:55Z"
---

# B1248 — The health endpoint reports content ok without ever checking the content root is writable

## Why

Throughout the five-hour signup outage in B1246, `/api/health` answered

```json
{"status":"ok","content":{"ok":true}, …}
```

The content root was readable and unwritable, and every write into it failed.
`content.ok` is what an operator watches to know the content directory is
sound, so an outage that is *entirely* about the content directory went past it
without a mark.

Reading is not the property worth checking. A journal is read from disk on every
request, so a read failure surfaces instantly as broken pages; a write failure
surfaces only when somebody tries to sign up, publish, or upload — which may be
hours later and will look like a bug in the wizard.

`backup` in the same document already reports a *failure that happened*
(`lastFailure`), so the shape exists here.

## Work

- Have the `content` check prove writability, not just presence — write and
  remove a probe file under `contentRoot()`, and report the failure with the
  path and errno when it fails.
- Decide deliberately whether an unwritable content root degrades the top-level
  `status`. It should: the instance cannot accept a single new day.
- Keep it cheap; `/api/health` is polled.

## Acceptance

- With the content root made read-only, `/api/health` says so — `content.ok`
  false, with a reason naming the path — and the overall `status` is not `ok`.
- With it writable, no probe file is left behind.
