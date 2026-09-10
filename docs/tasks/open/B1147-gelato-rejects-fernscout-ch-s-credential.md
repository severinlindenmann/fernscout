---
id: B1147
title: Gelato rejects fernscout.ch's credential, so no photobook in a real journal can be priced
type: ISSUE
priority: high
complexity: low
area: photobook, ops, credits
found: "2026-09-09T18:38:32Z"
---

# B1147 — Gelato rejects fernscout.ch's credential, so no photobook in a real journal can be priced

Found during B108, against fernscout.ch on 2026-09-09.

## Why

The photobook capability is on, configured against a live printer, and cannot
price a book. From the deployed config:

```
"photobook": { "enabled": true, "provider": "gelato", "live": true }
```

`GELATO_API_KEY` is present — `npm run photobook -- --providers`, run on the
host with the service's own environment, reports gelato as **ready** rather
than *needs setup*. The key exists. Gelato does not accept it:

```
Sep 09 20:23:57  [request] GET /severin/photobooks/b7859a69-… ua="Mozilla/5.0 … Chrome/151"
Sep 09 20:23:58  gelato refused: {"message":"Unauthorized"}
```

That is a **person, in a browser, in the owner's real journal**, opening a
photobook proposal — and the page could not price it.

It has not always been so. Earlier the same day Gelato's own servers came and
fetched the PDFs, which only happens once a request has been accepted:

```
Sep 09 06:55:12  GET /example/photobooks/sl065307/book-cover.pdf      ua="GelatoAPI"
Sep 09 06:58:13  GET /example/photobooks/bk065538-largesquare-hard/…  ua="GelatoAPI"
```

So the credential worked at 06:58 and was refused at 20:23. Something changed
between: a rotated or expired key, an account change at Gelato, or — the shape
worth checking first — a malformed append to `/etc/fernscout/env`, where a line
without a trailing newline swallows the variable after it.

`npm run photobook -- --providers` cannot tell you any of this. It checks the
key is *set*, never that it is *accepted*, and it says "ready" either way. That
is the gap that let a broken credential sit unnoticed on a live instance.

## Work

This is a credential, not code, so the fix is on the host:

1. Establish which of the two states holds — key wrong, or key eaten by the
   line above it in `/etc/fernscout/env`. Check the file's shape (does every
   line have an `=`, does the file end in a newline) before assuming the key
   itself is bad.
2. Replace or repair it in `/etc/fernscout/env` and nowhere else. Never in
   `site/config.json`, never in a commit, never echoed into a chat.
3. Confirm by opening a photobook proposal page and seeing a price, not by
   reading `--providers`.

Then decide the standing question this exposed: **should `/api/health` say
anything?** It reports `photobook: {"enabled": true}` with no note, while
`postcards` right beside it carries one. A health check must not call the
printer on every request, but a cached last-known result, or a note that the
key has never been exercised, would have surfaced this before a person did.
That half is arguably its own ticket — capture it rather than growing this one.

Beside it, and separately: **B1148**, which is why the person on the page was
told the printer was unreachable and to try again shortly.

## Acceptance

- A photobook proposal page in a real journal shows a price.
- `journalctl -u fernscout | grep "gelato refused"` is empty for the period
  after the fix.
- The state the credential was left in is written down here.
