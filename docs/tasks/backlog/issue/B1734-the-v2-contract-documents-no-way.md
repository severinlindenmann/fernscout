---
id: B1734
title: The v2 contract documents no way to sign in, so /openapi.json cannot be retired
type: ISSUE
priority: medium
complexity: medium
area: api v2, contract
found: "2026-09-14T12:03:19Z"
---

# B1734 — The v2 contract documents no way to sign in, so /openapi.json cannot be retired

## Why

An audit asked why `/content-model.json` was retired with a 410 and
`/openapi.json` still answers 200 with `info.version: 1`. Measured:

```
$ curl -s -o /dev/null -w '%{http_code}\n' https://fernscout.ch/openapi.json
200
$ curl -s https://fernscout.ch/openapi.json | jq '.info.version, (.paths|length)'
1
13
```

The answer is that the two documents are not the same kind of stale.
`/content-model.json` described a file shape the instance had stopped
accepting — it was wrong. `/openapi.json` is **the only published contract for
`/api/auth/**`**, which is not v1 at all: it is the current and only way any
client signs in. Its thirteen paths are the six auth doors, the two surviving
v1 routes (`track`, `deletions/{token}`), `/api/health` and the markdown twins.

```
$ curl -s https://fernscout.ch/api/v2/openapi.json | jq '[.paths|keys[]|select(startswith("/api/auth"))]|length'
0
```

So retiring it today would leave a client able to read every write door and no
way to obtain the token they all require. That is worse than the trap it
currently is.

**The trap is real too**: a client discovering `/openapi.json` gets a valid
document titled "Fernscout API" announcing version 1, and fernscout-helper
cached exactly that and reported success while every route it called answered
404 (B1715). Its own fix was to require `info.version === 2` — which only works
because there is a second document to require.

## Work

- Put the auth surface into the v2 document, generated from
  `lib/api/v2/schemas/auth.ts` the way every other v2 operation is. It is
  already the schema those routes parse with.
- Then `/openapi.json` has two surviving v1 routes left in it and can be
  retired the way `/content-model.json` was — a 410 naming its replacement.
- Until then, the v1 document must not read as *the* contract: its `info.title`
  and `description` should say what it is and point at `/api/v2/openapi.json`.

## Acceptance

- A client can sign in using `/api/v2/openapi.json` alone.
- `/openapi.json` either 410s naming its replacement, or says in its own title
  that it is not the API's contract.

## Interim half done, 2026-09-14

The document now says what it is, in its own title and description:

```
title: "Fernscout — sign-in and the last v1 doors (NOT the API contract)"
```

with the description naming `/api/v2/openapi.json`, saying why the two v1
routes survive (neither is a document: one derives a clipped public line from
a position history no route may return, the other is the human-only half of a
deletion), and telling a caller to require `info.version === 2` of whatever it
caches — which is the check that would have caught B1715.

The ticket stays open for the half that matters: auth belongs in the v2
document, and until it is there this file cannot be retired.

## Done, 2026-09-14

All four decided items are built, on branch `b1734-auth-v2`:

1. **The eight `/api/auth/**` operations now live in `/api/v2/openapi.json`**
   (`lib/api/v2/openapi.ts`), generated the same way as every other v2
   operation: `codes`, `codes/redeem` and `links/redeem` use the Zod
   schemas the routes already parse with (`lib/api/v2/schemas/auth.ts`);
   `signup/phone`, `signup/phone/redeem`, `handover` (both doors) and
   `{user}/keys` have no schema file of their own (they never did — even
   v1 typed their bodies by hand), so their shapes are declared once, ad
   hoc, in `lib/api/v2/openapi.ts` itself, next to the other ad-hoc shapes
   already there. `/api/auth/identity/**` and `/api/auth/logout` are still
   deliberately out of scope — cookie-only, carried over from v1's own
   `OUT_OF_SCOPE_PREFIXES` reasoning, now `AUTH_OUT_OF_SCOPE_PREFIXES` in
   `test/openapi-v2-contract.test.ts`, which walks `app/api/auth` (minus
   that prefix) the same way it already walked `app/api/v2`, so the
   document and the filesystem cannot drift apart in either direction.
2. **`track` and `deletions/{token}` are at `/api/v2/{user}/...` addresses**
   and documented there too — the previous agent had already ported the two
   route files; this pass added their missing `/api/v2/openapi.json`
   entries (the route-inventory test caught the gap immediately) and fixed
   two live response strings in `app/api/v2/[user]/import/route.ts` that
   still told a caller to `POST /api/v1/.../track` after the move.
3. **`/api/v1` is gone.** The directory no longer exists (done before this
   session started). `test/deletions.test.ts` and
   `test/gps-import-route.test.ts` still imported and called the deleted
   v1 route modules directly — updated to the v2 modules and addresses.
   One real behaviour difference fell out of the port: the v2 `track` door
   uses the shared `requireJournalOwner` gate (like every other owner-only
   v2 route) rather than v1's own hand-written "out_of_scope" wording for
   a trip-scoped token, so that refusal is now `forbidden` — the same code
   `import` already answers a trip-scoped token with, for the same reason.
   Updated the test to match; this is the intended v2 pattern, not a
   defect.
4. **`/openapi.json` now answers 410**, naming `/api/v2/openapi.json` as
   its replacement — `app/openapi.json/route.ts`, same shape as
   `app/content-model.json/route.ts` (B1700). `lib/api/openapi.ts` and
   `test/openapi-contract.test.ts` are deleted. `npm run unused` then
   named five exports that existed only for that file: `outOfScope` and
   `errorResponse` in `lib/api/auth.ts` (their v2 equivalents in
   `lib/api/v2/auth.ts` were already what everything else used),
   `VISIBILITY_ENUM_NOTE` in `lib/api/agentCopy.ts`, `EDITABLE_DAY_FIELDS`
   in `lib/api/entries.ts`, and `FIGURE_FIELDS` in `lib/tripWrite.ts`
   (still used internally — just dropped its `export`). All five removed
   or de-exported; `npm run unused` is clean.

   Two other tests read the v1 document directly and needed updating for
   the 410, independent of the auth move: `test/health-disclosure.test.ts`
   (the "example username never names an unadvertised journal" leak check
   — repointed at `/api/v2/openapi.json`, which has the same worked
   example) and `test/invite-links.test.ts` (a stale "v1's openapi no
   longer lists invites" canary — replaced with a check that `/openapi.json`
   answers 410 and names its replacement).

**The deletion-link window (the thing this run was told to report):**
`DELETION_TTL_MS` in `lib/deletions.ts` is **60 minutes** — `60 * 60 *
1000`. The mailed link never names the API address directly; it points at
the page (`app/[user]/delete/[token]`), which composes the confirm
button's endpoint fresh on every render — now `/api/v2/{user}/deletions/
{token}` — so a link already sitting in a mailbox keeps working across
this move without needing a redirect or a grace period. Combined with the
one-hour token lifetime, there is no meaningful window where an old mailed
link could be stranded by `/api/v1` returning 404: anything that survived
long enough to be affected had already expired on its own first.

**Verify:** `VERIFY_WILL_WAIT=1 npm run verify` — build, TypeScript,
ESLint, Vitest (604 files, 7726 passed, 4 skipped, unrelated to this
ticket), knip — all green.

**The error-vocabulary sweep was carried across, not lost.** Deleting
`test/openapi-contract.test.ts` legitimately dropped its route-inventory and
enum halves — those describe a document that no longer exists. It also
would have silently dropped the one place that checked *every* error code
the whole API answers with is in `ERROR_CODES`, and vice versa
(AGENTS.md: "keep every existing keeper unless the ticket explicitly
changes its contract" — retiring the v1 document did not change that
contract). Ported both assertions, plus their guard-rail sanity check and
doc comments, into a new `describe("every error code a route answers with
is published", …)` at the bottom of `test/openapi-v2-contract.test.ts`.
Scan roots updated for what exists now: `app/api/auth` + `app/api/v2` +
the same `SPEAKS_TO_CALLERS` domain modules for the "is it documented"
direction; `app/api/helper` + `app/[user]` + `app/api/web` (the same
cookie-only allowlist, same reasoning kept in the comment) for the
"nothing is dead" direction.

Proved it still bites: added a throwaway `return Response.json({error:
"not_a_real_code"})` behind `if (false as boolean)` to
`app/api/v2/status/route.ts`, ran `npx vitest run
test/openapi-v2-contract.test.ts` —

```
FAIL  test/openapi-v2-contract.test.ts > every error code a route answers with is published > is in ERROR_CODES, so an agent can look it up
AssertionError: add these to lib/api/errorCodes.ts, saying what to do about each: not_a_real_code: expected [ 'not_a_real_code' ] to deeply equal []
Tests  1 failed | 93 passed (94)
```

— then removed the throwaway line and reran clean (94/94 passed, no diff
left in the route file). Full `VERIFY_WILL_WAIT=1 npm run verify` is green
again with the sweep in place.
