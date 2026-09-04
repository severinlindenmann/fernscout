---
id: B234
title: An unauthenticated health check discloses server paths and journal names
type: SECURITY
priority: low
complexity: low
area: ops, health
found: "2026-09-04T07:59:28Z"
started: "2026-09-04T08:08:59Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T08:08:59Z"
---

# B234 — An unauthenticated health check discloses server paths and journal names

## Why

`/api/health` is unauthenticated by design — it is what an uptime monitor
polls, and `app/api/health/route.ts` argues that case well. Two fields in it go
further than "on or off", and both were added for good reasons that did not
consider an anonymous reader.

**Server paths.** `content: { ok: false, error }` carries the message built in
`lib/users.ts:158`:

```ts
const message = `${root} could not be read: ${(error as Error).message}`;
```

`root` is the absolute content directory (`/srv/fernscout/content`, or whatever
the operator chose) and the errno text names it again. `config: { ok: false,
error }` is a `ConfigError` message and carries the same class of detail. Both
are served to anybody who asks, and both appear exactly when the instance is
already unhealthy — which is when somebody probing is most likely to be
looking. B197 added the first of these; it is the right field, in the wrong
audience.

**Journal names.** The `journals` block lists a username for every journal that
has *narrowed* a capability. A journal with `visibility: private` in its own
`config.json` is meant to be absent from `/documentation.txt`, the landing page
and `sitemap.xml` (see AGENTS.md, "A private journal is unlisted"). If it has
switched anything off — mail, contacts, costs — its name appears here instead.
That is a small hole in a promise that is otherwise carefully kept.

Neither is a credential and neither is a way in; this is reconnaissance, and it
is filed as low for that reason. It is also the field an external probe under
B101 would read first.

Found by the B22 sweep; see `docs/security/2026-09-04-sweep.md`.

## Work

**Done.** `/api/health` stays unauthenticated — an uptime monitor cannot hold a
credential — and the line drawn is **the state is public, the detail is not**.

### Where the line went, and why there

The tension this ticket names is real: AGENTS.md requires that `/api/health`
explain why a capability is off, and B197 deliberately made an unreadable
content root reportable here. Both survive intact, because neither of them
needs the two things a stranger should not have.

**Public, to anybody:** `status`, `time`, `uptimeSeconds`, `version`, `commit`,
`backup`, `responseTimeMs`, every block's `ok` boolean **and a new
machine-readable `code`**, and the whole `capabilities` block *including every
reason*. Capability reasons name env vars and config keys — "not enabled on
this server", "features.auth is enabled but SESSION_SECRET is not set" — never
a value, never a path, never a person. That promise is kept in full, and a test
asserts it rather than trusting it.

**Behind `HEALTH_TOKEN` (environment only, `Authorization: Bearer`):** the
free-text `error` on `config`, `content` and `basemap`, which is what carried
the absolute content-root path and the errno; and the `journals` rows of
journals this instance does not advertise.

**B197's diagnostic survives the redaction, which is why the field was redacted
rather than dropped.** B197's complaint was that an empty `journals` block
reads exactly like an instance with no journals, so nothing could say "cannot
tell" rather than "nothing to report". `content: { ok: false, code:
"unreadable" }` is what says it, and that is public. Only the path is held
back — and `getUsernames()` has already written the whole message to stdout,
where the operator entitled to it already is.

**`journals` is filtered by `listedUsernames()`** rather than by a new rule.
That function's own docstring already says "use this for anything that hands
out the existence of a journal", and it is what `/documentation.txt`, the
landing page and `sitemap.xml` use — so there is one answer to "may this name
be handed out" instead of two that will disagree within a month. A journal
whose config says `visibility: private` had its name here as soon as it
narrowed anything.

**`journalsWithheld` counts what the filter dropped.** A silent filter is worse
than the leak for the operator it is aimed at: somebody debugging a 404 would
read a truncated list as a complete one and conclude the journal is fine. A
count names nobody and cannot be turned into a URL, so it discloses that *some*
unlisted journal narrowed *something* — which is a long way from the name.

A shared operator secret rather than an owner's bearer token, because the
question this page answers is about the *instance* — its filesystem, its
config, its journal list — and on a multi-journal instance no single journal's
owner is the authority on that. **An unset `HEALTH_TOKEN` entitles nobody**,
never everybody: the safe default for a fresh install is the redacted page.

Documented in `.env.example` and in `docs/runbook.md` (a table of which field
is on which side), and in the route's own docstring so the next field added
lands on the right side.

`GET` takes its `Request` now, so `test/mail-journal-switch.test.ts`,
`test/basemap-bundle.test.ts` and `test/backup-status.test.ts` pass one; the
two that asserted on `.error` now assert on the redacted `.code`, with a
pointer to the new test file that asserts both halves.

Not done: `keepingCopies`, which is a boolean about a setting and names
nothing; `status` and the HTTP codes, which are untouched.

## Acceptance

`test/health-disclosure.test.ts` is new: a monitor's assertions unchanged, an
unreadable content root reported without its path (asserted against the
serialised body, not just the field, because the next field added is the one
that leaks it), an unadvertised journal not named, capability reasons still
public — and, on the other side, `HEALTH_TOKEN` bringing back the path, the
errno and every journal, with a wrong token, an unset one and an empty one all
reading as strangers.

### Live, against `next dev` on a fixture instance

Two journals: `shown` (public) and `hidden` (`visibility: private`), both with
`reactions` narrowed off, so both qualify for the `journals` block.

**Before**, anonymously:

```json
"journals": { "hidden": { "reactions": { "enabled": false, "reason": "not enabled by hidden" } } }
```

and with the content root made unreadable, still anonymously:

```json
"config": { "ok": false, "error": "/private/tmp/.../scratchpad/content/config.json is not usable:\n  - could not be read. …" }
```

**After**, anonymously:

```json
"config": { "ok": false, "code": "unusable" },
"journals": {},
"journalsWithheld": 1
```

and with `Authorization: Bearer $HEALTH_TOKEN`:

```json
"config": { "ok": false, "code": "unusable", "error": "/private/tmp/.../content/config.json is not usable: …" },
"journals": { "hidden": { "reactions": { "enabled": false, "reason": "not enabled by hidden" } } }
```

`503` and `status: "error"` in every column; a monitor asserting on `status` or
`backup.state` needs no change.

`npm run build`, `npx tsc --noEmit`, `npx eslint .` and `npx vitest run` all
pass: 138 files, 2165 tests, 3 skipped.
