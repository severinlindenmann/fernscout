---
id: B579
title: A stale health cache silently switches off the media checks
type: ISSUE
priority: medium
complexity: low
area: fernscout-helper, api cache, validate-content
found: "2026-09-06T14:03:33Z"
started: "2026-09-06T14:06:05Z"
merged: "2026-09-06T14:12:22Z"
completed: "2026-09-07T13:12:11Z"
---

# B579 — A stale health cache silently switches off the media checks

## Why

Found on 2026-09-06 while verifying B577, and it is why that verification
briefly disagreed with itself.

`shared/api.mjs` caches `<site>/api/health` under `export/.schema/` for a day.
`export/` is gitignored, so every checkout keeps its own copy and a long-lived
one goes stale without anybody touching it. The cached copy in one checkout
had no `media` block at all — an older shape, from before the server published
its upload limits.

`validate-content` uses `health().doc.media` for the checks that need the
instance's own numbers: which image formats it accepts, and how large a file
may be. With no `media` block those checks do not run. **They do not fail, and
nothing is printed** — the run simply contains fewer checks than the reader
believes.

The same `luecken` fixture, the same commit, two checkouts:

    stale cache:     luecken   19 errors, 5 warnings
    refreshed cache: luecken   20 errors, 5 warnings

The missing error was a planted disallowed image format — a fault the fixture
exists to catch. The self-test still passed, because its floor is "at least
12", so the silent loss of a check was invisible at both levels at once.

This also reaches real journals. A validation run reported as clean may never
have checked a single photograph's format or size, and the report says nothing
to distinguish that from a run that checked them and found nothing.

`validate-content`'s own `SKILL.md` already sets the standard this falls short
of: when the schema cannot be fetched "it says so and checks the file format
alone... the report says which one you got — do not report a clean run as a
clean bill when the instance's own rules were never consulted." That is exactly
right, and the `media` half of the contract is not held to it.

## Work

- When a capability the checks depend on is absent from the cached health
  document, say so in the report, in the same place the schema-unavailable
  notice goes. A check that did not run must be visible as a check that did not
  run.
- Treat a health document with no `media` block as stale rather than as an
  instance without limits — the two are indistinguishable today and mean
  opposite things. A refetch when the shape is unrecognised is cheap, and the
  cache is already time-limited.
- `--refresh` refetches the openapi document; make sure it refetches health
  too. Verify: the run that found this had to overwrite the health cache with
  `curl` by hand because `--refresh` left it alone.

Not doing: removing the cache. A day's caching is right; a fresh fetch per run
is a request per validate.

## Acceptance

- Validating a journal against a cached health document with no `media` block
  prints a line saying the photograph checks did not run, and the exit status
  is unchanged.
- `--refresh` replaces the cached health document, demonstrated by a stale
  cache before and a current one after.
- `selftest.mjs` reports the same error count for `luecken` on a stale and a
  refreshed cache, or says why it cannot.
