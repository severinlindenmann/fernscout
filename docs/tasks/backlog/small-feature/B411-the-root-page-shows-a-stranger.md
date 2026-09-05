---
id: B411
title: The root page shows a stranger's welcome to somebody who is signed in and holds three journals
type: FEATURE
priority: high
complexity: medium
area: landing, viewer, api
found: "2026-09-05"
related: B410, B412
---

# B411 — The root page shows a stranger's welcome to somebody who is signed in and holds three journals

## Why

`app/page.tsx` renders one page for everybody: the pitch, the copy-this-to-your-agent
block, and the journals `listedUsernames()` advertises. That is the right page
for somebody who has just arrived and does not know what this is. It is the
wrong page for the person who owns a journal here, and it is the only page they
get — including when they open the installed PWA, whose `start_url` is `/`.

The journals a signed-in reader may actually open are mostly **not** on it.
`listedUsernames()` deliberately excludes a `guest` journal, and a `private`
trip is advertised nowhere by design, so a reader approved into two journals
sees a page that names neither.

Blocked on B410: with one journal-scoped cookie there is no query that can
produce "journals this address may open".

## Work

Signed out, `/` is today's `Landing`, unchanged.

Signed in, in this order:

- **Your journals**, grouped by how you got in — reusing `ViewerTrip.through`'s
  vocabulary (`owner` / `traveller` / `guest`) so the panel and the gate keep
  one word for one fact (B80). Unlisted journals included where the reader
  holds a role: that is the point, and `getUsernames()` filtered by role is the
  query `listedUsernames()` cannot be.
- **Public journals on this server** — today's list, below.
- **Your agent** — the instruction block from `Landing`, plus the B283 handover
  button on journals where the reader is the owner.
- **Your devices** — created, last seen, user agent; revoke per row and sign
  out everywhere. This is the whole revocation surface for B410's identity, and
  it belongs to the person whose credential it is.

`GET /api/v1/me/home` serves the personal half as JSON so B412 can cache it
apart from the shell. It authenticates on `fs_identity` and on nothing else.

One refactor in existing code, and it is the reason this is not larger:
`resolveViewer()` (`lib/viewer.ts`) reads the cookie itself, so it cannot be
asked about an arbitrary address. Split out the part that takes an email; keep
`resolveViewer` as the cookie-reading wrapper. One resolver serves `/<user>/me`
and the cross-journal loop, rather than a second implementation that drifts
from it — which is precisely how B41 happened.

**Not** in this task: any editing surface. The agent is the editor
(ROADMAP decision 24) and the owner's row links to the handover, not to a form.

## Acceptance

- A signed-in reader sees every journal they hold a role in, including
  unlisted ones, each labelled with the role that opens it.
- A signed-out reader sees exactly today's landing page, byte for byte in
  content if not in markup.
- A reader with no role anywhere sees the public list and the agent block, and
  no empty "your journals" heading.
- The role each journal is labelled with matches what `mayReadTrip` then
  allows — pinned in `test/access-gate.test.ts`'s viewer x trip table.
- `/api/v1/me/home` refuses a guest cookie, an agent bearer token and no
  credential at all.
