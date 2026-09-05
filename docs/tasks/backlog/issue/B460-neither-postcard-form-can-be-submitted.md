---
id: B460
title: "Neither postcard form can be submitted: the redirect leaves the origin and CSP blocks it"
type: ISSUE
priority: high
complexity: low
area: postcards, csp
found: "2026-09-05T16:05:00Z"
---

# B460 — Neither postcard form can be submitted: the redirect leaves the origin and CSP blocks it

## Why

Pressing **Send** or **Save the words** on `/<user>/postcards/<id>` does
nothing, and the browser console says:

```
Sending form data to 'https://fernscout.ch/example/postcards/<id>/send'
violates the following Content Security Policy directive: "form-action 'self'".
The request has been blocked.
```

The policy is not the bug. `next.config.ts` sets `form-action 'self'` and the
form posts to the same origin, which is allowed. What is blocked is the
**redirect afterwards** — `form-action` is checked against every hop, and the
`Location` header names another origin:

```
$ curl -si -X POST https://fernscout.ch/example/postcards/<id>/send
HTTP/2 303
location: https://localhost:3000/example/postcards/<id>?result=forbidden
```

Both routes build it as `new URL(path, request.url)`, and behind Caddy
`request.url` is the app's own `127.0.0.1:3000` origin rather than the one the
reader is on. So the send button — the only thing in the codebase that spends
credits at a printer — has never worked in a browser, and neither has the edit
form. `app/[user]/u/[token]/route.ts` is the one pre-existing redirect and it
does not have this bug: it uses `serverSite().url`.

**Nothing caught it** because the tests render markup and assert on strings,
and there is no browser anywhere in the suite. That is the more important half
of this ticket.

## Work

- `app/[user]/postcards/[id]/send/route.ts` and `.../message/route.ts`: emit a
  **relative** `Location` — `/<user>/postcards/<id>?result=…` — via
  `new Response(null, { status: 303, headers: { Location } })`.
  `Response.redirect()` demands an absolute URL, which is what led here.
  Relative is better than `serverSite().url` for a redirect a browser follows
  in place: the browser resolves it against whatever origin it is actually on,
  so it is right on `localhost`, on `fernscout.ch`, and on a self-hoster's
  domain whose `site.url` is stale.
- A test that asserts the header is relative, or at least that it never
  contains `localhost` or a scheme. Cheap, and it is exactly the assertion
  that would have caught this.

## Acceptance

- `curl -si -X POST https://<host>/<user>/postcards/<id>/send` answers `303`
  with a `location` that starts `/` and names no host.
- Pressing Send and Save in a browser works, with no CSP violation logged.
- A test fails if either route grows an absolute redirect again.
