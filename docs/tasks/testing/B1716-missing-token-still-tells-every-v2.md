---
id: B1716
title: missing_token still tells every v2 caller that /api/v1 needs a token
type: ISSUE
priority: low
complexity: low
area: api, copy
found: "2026-09-14T09:23:20Z"
started: "2026-09-14T09:51:45Z"
merged: "2026-09-14T09:57:56Z"
---

# B1716 — `missing_token` still tells every v2 caller that `/api/v1` needs a token

## Why

```
$ curl -s https://fernscout.ch/api/v2/example/trips
{"error":"missing_token","message":"No `Authorization: Bearer` header. Every
/api/v1 call needs one; get a token from /api/auth/codes and
/api/auth/codes/redeem, both with \"for\": \"write\"."}
```

`lib/api/errorCodes.ts:32`. This is the first sentence an unauthenticated
caller of the v2 API reads, and it sends them to a version that answers 404.

B1677 swept caller-facing `/api/v1` strings and reports "every caller-facing
`/api/v1` string repointed", with `test/no-dead-route-in-copy.test.ts` guarding
it — but that test looks for *route paths with no file behind them*, and
`/api/v1` here is a prefix in prose rather than a path, so it passes over the
one string every refused call returns. Filed separately rather than reopening
B1677, which is in `testing/` and whose own work landed.

## Work

- Repoint the sentence. It is shared by v1 and v2 doors, so it should name
  neither version: "Every call to this API needs one".
- Widen `test/no-dead-route-in-copy.test.ts` (or add a sibling) to catch a bare
  `/api/v1` prefix in caller-facing copy, not only a full path.

## Acceptance

- An unauthenticated `GET /api/v2/{user}/trips` answers with a message that
  names no dead version.
- A test fails if `/api/v1` reappears in a returned string outside the three
  surviving v1 routes.

---

## Revalidated, 2026-09-14 — valid

`lib/api/errorCodes.ts:32` still carried the sentence, and
`https://fernscout.ch/api/v2/example/trips` still answered with it. The reason
B1677's guard missed it is confirmed in `test/no-dead-route-in-copy.test.ts:41`:
`MENTION` requires `/api/v[12]/` — a trailing slash and a path after it — so a
version named as a bare prefix in prose never reaches `routeExists`.

## Done, 2026-09-14

The sentence now names no version at all ("Every call to this API needs one"),
which is the honest form: `missing_token` is returned by the surviving v1
routes, by every v2 door and by the auth doors, so naming any one of them was
wrong even before v1's write surface went.

`BARE_V1` in the same test catches `/api/v1` with no path after it, in the same
non-comment lines the existing scan walks, with the same `moved from` / `was`
escape hatch for history. Only `v1`: `/api/v2` is the API this server serves,
so a string naming it tells the truth, and a string naming a v2 *door* that
does not exist is what `MENTION` already covers.

Proved rather than assumed — with the old wording put back, the test fails with
`lib/api/errorCodes.ts:34 — /api/v1, named as the API a caller should use`; with
the new wording it passes.
