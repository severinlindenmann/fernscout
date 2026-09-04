---
id: B234
title: An unauthenticated health check discloses server paths and journal names
type: SECURITY
priority: low
complexity: low
area: ops, health
found: "2026-09-04T07:59:28Z"
---

# B234 — An unauthenticated health check discloses server paths and journal names

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

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

- Decide who `/api/health` answers. The likely split: an anonymous caller gets
  `status`, `time`, `uptimeSeconds`, `version`, and each block's `ok` boolean;
  the *reasons*, the paths and the per-journal names need either a shared
  secret (`HEALTH_TOKEN`, environment only) or an owner's bearer token.
- If a token is not wanted, redact instead: report `content: { ok: false }`
  with a stable code rather than the path, and log the full message to stdout
  where the operator already is.
- `journals` should key on something that is not a username, or be behind the
  same gate.
- Whatever is chosen, keep `status` and the HTTP code exactly as they are — a
  monitor asserting `200`/`.backup.state === "ok"` must not need changing.
- Say in the docstring which fields are public and which are not, so the next
  field added lands on the right side.

Not doing: the `keepingCopies` flag, which is a boolean about a setting and
names nothing.

## Acceptance

- An anonymous `GET /api/health` on an instance with an unreadable content root
  answers 503 and contains no absolute filesystem path.
- An anonymous `GET /api/health` on an instance holding a `private` journal
  that has narrowed a capability does not name it.
- A monitor's existing assertions (`status`, `backup.state`) are unchanged.
- All four checks pass.
