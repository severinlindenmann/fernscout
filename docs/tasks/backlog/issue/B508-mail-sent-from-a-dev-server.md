---
id: B508
title: Mail sent from a dev server links to the production site
type: ISSUE
priority: low
complexity: low
area: mail, dev experience
found: "2026-09-05T18:32:38Z"
---

# B508 — Mail sent from a dev server links to the production site

## Why

A photobook ordered on a local dev server mails download links pointing at
`https://fernscout.ch`, not at `localhost:3000`. The receipt is otherwise
correct — right price, right page count, honest about nothing being printed —
and every link in it is unusable by the person who just pressed the button.

`serverSite().url` comes from `content/config.json`, which says what the site
is. That is right for production and for the sharing card; it is wrong for a
letter written by a server nobody outside the room can reach.

Found while testing B504 end to end locally (B506). Not a blocker — the files
are on disk and the page shows the same links, which do work — but it makes the
mail useless for exactly the case it is easiest to test in.

## Work

Decide whether a link in a letter should follow the configured site or the
origin that generated it, and make the rule explicit wherever it lands.

The honest options: keep the configured URL and say so in
`docs/running-locally.md`; or let a development server prefer its own origin,
which means the mail layer learning about requests, which it currently and
deliberately does not.

**Not doing:** guessing the origin in production. A letter that links wherever
the request happened to arrive from is a letter that can be made to link
anywhere.

## Acceptance

- A receipt generated on a dev server either links somewhere that works, or the
  local-testing documentation says why it does not.
