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

- `contentRootWriteProblem()` in `lib/users.ts` proves writability: it writes
  and removes a probe file named `.health-write-probe-<pid>` under
  `contentRoot()` (pid-named so two processes sharing a root during a rolling
  deploy never race each other's probe), never throws, and returns the errno
  text with the path on failure — the same shape `contentRootProblem()`
  already used for a read fault.
- `app/api/health/route.ts` runs it only when the read already succeeded — a
  root that cannot be listed is already unusable, and running a write probe
  against it would just repeat the same fault under a different name. The
  fault carries a distinct `code`: `"unreadable"` for a listing failure,
  `"unwritable"` for a write failure, so an operator reading `content.code`
  knows which one happened rather than always seeing the read-era name.
- The top-level `status` degrades on either fault, unchanged from before: an
  instance that cannot write a single new day was never `ok` because its
  existing days still render.
- Cheap by construction — one `writeFileSync` and one `unlinkSync`, no new
  process, run once per `/api/health` call.
- `content.error` (the path and errno) stays behind `HEALTH_TOKEN`, the same
  gate it already sat behind for a read fault — B1248 changes what is
  checked, not who is entitled to the detail. See B1045 for that gate's own
  reasoning.

## Acceptance

- With the content root made read-only, `/api/health` says so — `content.ok`
  false, with `code: "unwritable"`, and the overall `status` is not `ok` — met
  and asserted in `test/health-content-writable.test.ts`.
- With it writable, no probe file is left behind — asserted in the same file.
- The path and errno text are absent for an unauthenticated caller and present
  with `HEALTH_TOKEN` — also asserted there.
