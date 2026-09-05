---
id: B473
title: Journal names and their capability posture are handed out unauthenticated by /api/health and /openapi.json
type: SECURITY
priority: high
complexity: low
area: api
found: "2026-09-05T13:36:44Z"
started: "2026-09-05T13:37:12Z"
session: 7c3dd4ae-2d91-4172-8ea8-52deb35f9f42
claimed: "2026-09-05T13:37:12Z"
---

# B473 — Journal names and their capability posture are handed out unauthenticated by /api/health and /openapi.json

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`curl -s https://fernscout.ch/api/health`, no credential:

```json
"journals": {
  "example":        { "signup": { "enabled": false, "reason": "not enabled by example" } },
  "qa-addr-0905":   { "push": {...}, "whatsapp": {...}, "signup": {...} },
  "qa-invite-0905": { ... },
  "xydhd-solo":     { ... }
},
"journalsWithheld": 6
```

B234 already drew a line here and drew it in the right place for what it was
asked: the six *unlisted* journals are withheld. What is left is still four
journal names and, for each, which capabilities that journal has and has not
switched on — and `HEALTH_TOKEN` is unset on this instance, so nothing about
this page is behind a credential at all.

Two arguments that this is over the line, and the second is the stronger:

- **A listed journal's name is public; its capability posture is not.** The
  name is on `/documentation.txt` and the landing page by design. That
  `qa-invite-0905` has push off and signup off is operator debugging detail
  about a deployment, and the whole reason the `journals` block exists is
  somebody at 2am comparing it against a 404 — which is exactly the audience
  `HEALTH_TOKEN` was invented for.
- **`journalsWithheld: 6` is a live count of unlisted journals.** B234 reasoned
  that a count names nobody, which is true and is not the same as saying
  nothing: it says this instance has six journals that do not want to be found,
  and it tracks their number over time.

### The inconsistency the audit turned up

Asked whether the rule is applied everywhere. `listedUsernames()` — whose own
docstring says "use this for anything that hands out the existence of a
journal" — is used by `app/sitemap.ts:45`, `lib/home.ts:81`,
`lib/api/documentation.ts:81`, and `lib/api/documentation.ts:455` for the
example username in a public document.

`lib/api/openapi.ts:34` does the same job and does not:

```ts
const example = getDefaultUsername() ?? getUsernames()[0] ?? "username";
```

`/openapi.json` is public and unauthenticated. On an instance with no
`defaultUser` set, that puts the first journal *directory name* — sorted, so
whichever sorts first, listed or not — into a published API document as the
worked example. `documentation.ts:455` is the same line written correctly, four
files away, which is what makes this a slip rather than a decision.

Everything else checked and correct: `getUsernames()` in
`generateStaticParams`, `lib/journals.ts`, `lib/home.ts:111` (per signed-in
address), and the scripts are all either build-time, authenticated, or
operator-side.

## Work

1. Move the whole `journals` block behind `HEALTH_TOKEN`, and
   `journalsWithheld` with it — a count of the journals hiding on this instance
   is not a monitor's business either. What replaces it for an unauthenticated
   caller is nothing at all: the field is absent, not empty. An empty object
   would read as "this instance has no journals", which is precisely the
   ambiguity B197 fought to remove.
2. **Keep B197's diagnostic public**, which is the constraint that decides
   point 1 is safe: `content: { ok: false }` and its `code` stay
   unauthenticated, and that is the field that distinguishes "cannot tell" from
   "nothing to report". Only the roster moves.
3. `lib/api/openapi.ts:34` → `listedUsernames()[0]`, matching
   `documentation.ts:455`.
4. Set `HEALTH_TOKEN` on the VPS, or the block is unreachable by anybody.

Not doing: authenticating the rest of `/api/health`. An uptime monitor cannot
hold a credential, and every field a monitor asserts on — `status`, `backup`,
each capability and its reason — stays public. That promise is B234's and it
is kept.

## Acceptance

`curl -s https://fernscout.ch/api/health | jq` has no `journals` and no
`journalsWithheld` key. The same call with `Authorization: Bearer $HEALTH_TOKEN`
has both, unfiltered. `/openapi.json` on an instance with no `defaultUser` and
one unlisted journal names neither.
