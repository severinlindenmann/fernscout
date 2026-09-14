---
id: B1741
title: The dry-run WhatsApp backend writes every outbound body to disk, now including a live invite token
type: ISSUE
priority: low
complexity: low
area: whatsapp, dev
found: "2026-09-14T16:26:19Z"
started: "2026-09-14T16:33:09Z"
merged: "2026-09-14T16:42:27Z"
---

# B1741 — The dry-run WhatsApp backend keeps every outbound body

## Why

`lib/whatsapp/reply.ts:sendDryRun` writes the complete outbound message body to
`content/<user>/whatsapp-replies/*.json` and to `console.log`, for every reply,
whenever `features.whatsapp.backend` is `dry-run`. The `cloud` backend does not:
it posts to Graph and logs nothing of the body.

Raised by the security review of B1736, which is the reason it is worth writing
down rather than leaving as a known dev convenience. Since B1736 a pressed
`invite_guest` returns its link in that body, so a dry-run instance now writes a
**live guest invite token** into a file under a real content root. The token is
otherwise deliberately shown once and stored only as a hash
(`app/api/helper/[user]/invite/route.ts`), which is the property this quietly
undoes wherever dry-run is pointed at content that matters.

The behaviour predates B1736 for every other body and is correct for what it is
for — the reply files are how the test suite reads what went out. The question
is only whether anything stops a dry-run instance being pointed at a real
`CONTENT_DIR`, and today nothing does.

**Valid**, revalidated 2026-09-14: `lib/whatsapp/reply.ts:34`'s `outputDir`
built its path from `contentRoot()`, and `sendDryRun` (`:111`) wrote the whole
`{to, ...outbound}` object into it.

## Work — as built

The second option, and `lib/mail/index.ts:92` is why it needed no argument:
every kept `.eml` on this instance — sign-in codes, guest invitations,
deletion links — already lives under `dataDir()/mail/<user>/` rather than in
anybody's journal. A dry-run reply is the same class of artifact for a
different channel and was simply filed in the wrong tree. So `outputDir` now
answers `dataDir()/whatsapp-replies/<user>`, kind first and then journal,
which is the shape `mail/` uses and which leaves the two as siblings under
`DATA_DIR` instead of opening a second per-person tree beside `content/`.

The "should dry-run refuse real content" question stops needing an answer once
the files are not in the content folder.

**The `console.log` line stays.** The printed reply is what dry-run is *for*
during local work, and an instance running dry-run is by definition not the
one serving real people.

## Acceptance

- A dry-run reply is written under `DATA_DIR` and nothing about it appears
  under `CONTENT_DIR` — `test/whatsapp-replies-are-not-content.test.ts`, which
  is the first test in this family to point the two environment variables at
  *different* directories. Every existing WhatsApp test sets both to one
  temporary folder, which is exactly why the suite could never have caught
  this.
- The journal-less case (`.whatsapp`) is covered too.
- The WhatsApp tests still assert on what was sent — all twelve files that
  read the reply folder were repointed and pass unchanged otherwise.
