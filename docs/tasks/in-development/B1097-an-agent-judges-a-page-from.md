---
id: B1097
title: An agent judges a page from its own reading of the code, because there is no instrument that shows it the page
type: CHORE
priority: high
complexity: medium
area: agent tooling
found: "2026-09-09T16:18:14Z"
<<<<<<< HEAD
started: "2026-09-09T16:26:07Z"
session: df031729-b5f3-42f2-bcac-c6c88d608ee0
claimed: "2026-09-09T16:26:07Z"
=======
started: "2026-09-09T16:26:18Z"
session: df031729-b5f3-42f2-bcac-c6c88d608ee0
claimed: "2026-09-09T16:26:18Z"
>>>>>>> b1097-page-instrument
---

# B1097 — An agent judges a page from its own reading of the code, because there is no instrument that shows it the page

## Why

Every rule in this repository about looking at a page is a rule agents keep
breaking, and the reason is cost. `test-in-a-browser` is five sections long
before the first screenshot: a database, a capability switched on in two
places, a sign-in, and an `HttpOnly` cookie that `document.cookie` cannot set.
An agent with a small change in front of it reads that, decides the JSX is
obviously right, and ships. B42 is what that costs — a second clock that drew
on the two demo days its own change had edited and on nothing else in the
world, green suite, inert feature, found by the owner in one click (B1090).

`curl` is not the fallback it looks like, though not for the reason this
ticket first gave. It claimed the trip hero was absent from the server HTML;
it is not — 55 of the 56 rendered lines of `/example/trips/alps-2024` are in
the response, and the one that is missing is `Photos & videos`, missing only
because `&` is escaped there. What `curl` cannot do is tell **present** from
**visible**. The same response carries JSON-LD, script payloads and markup the
animation has not revealed, and a grep that finds a word has learned nothing
about whether a reader ever sees it. Nor can it report a console error or a
request that 404ed — and on the first real page this instrument was pointed
at, `/api/reactions` was one.

And a screenshot alone is not the instrument either. The one thing an agent
can genuinely check its own work on is a web page — but only because a page
can also hand back its text, its console and its failed requests. An image on
its own is a thing to have an opinion about; an image beside
`document.body.innerText` and a console error is a thing to be wrong about in
public. Give the agent an instrument, or the person is the checker.

There is no such instrument here. `test-in-a-browser` describes a procedure
driven by MCP tools an agent holds interactively, which means a dispatched
subagent — the thing that actually does the work in a batch — often cannot run
it at all.

## Work

One script, no new dependency: `.claude/skills/test-in-a-browser/check-page.mjs`.

```
node check-page.mjs <url> <out-dir> [--cookie name=value] [--widths 1280,390] [--wait 2000]
```

Writes, per width, `<slug>-<width>.png`, and one `<slug>.json` carrying:
`url`, `status`, `title`, `innerText` (after the wait, not the fetched
markup), `consoleErrors`, `failedRequests`, and the widths captured.

Drive Chrome over CDP directly. Node 24 has a global `WebSocket`, so this is a
launch of `--headless=new --remote-debugging-port`, a `/json/new` for a target,
and `Page.navigate` / `Network.setCookie` / `Runtime.evaluate` /
`Page.captureScreenshot` / `Emulation.setDeviceMetricsOverride` over one
socket. `Network.setCookie` is what gets an `HttpOnly` session cookie in;
`document.cookie` silently returns `""` and is the trap that costs the most
time today.

Not doing: visual diffing, a baseline image store, a Playwright or Puppeteer
dependency, or a replacement for `test-in-a-browser`. That skill still owns
the database, the capability and the sign-in; this script owns the last step
only, and the skill gains a section pointing at it.

## Acceptance

- `node check-page.mjs http://localhost:3011/example/trips/alps-2024 /tmp/x`
  with the dev server up writes `<slug>-1280.png`, `<slug>-390.png` and
  `<slug>.json`; the JSON's `innerText` is the page in reading order rather
  than the response's markup; and the 390 image is 390 CSS pixels wide and as
  tall as the whole document.
- Passing `--cookie fs_session=...` from `/tmp/wt-cookies.txt` gets the
  `HttpOnly` session cookie in: `/example/me` reads *Sign in · You are not…*
  without it and *Your journals · Account…* with it. (Not a redirect — this
  application answers `200` and renders a gate, which is why the check is on
  the text and not on the status.)
- A page with a deliberate `console.error` reports it in `consoleErrors`; a
  page with a 404 asset reports it in `failedRequests`.
- The script exits non-zero when the page 500s or the navigation fails, so a
  caller can gate on it.
