---
id: B1826
title: Import guidance sits in documentation instead of in the flow
type: DOCS
priority: medium
complexity: low
area: docs, import, i18n
found: "2026-09-16T19:35:17Z"
---

# B1826 — Import guidance sits in documentation instead of in the flow

## Why

`/docs/extract` explains how to get photographs, location history, contacts and
bank statements out of the places they are stuck. A person meets that
explanation only if they go looking for it, and the page that actually needs it
links away to it — which NN/g's wizard guidance names directly as the failure:
a step must be self-sufficient, needing no information from elsewhere in the
app.

B1824 moves that guidance into the flow, at the moment of need. Once it lands,
the documentation is a second, drifting copy of the same instructions — and
these instructions drift fast: Google moved the Timeline export once already.

`/docs/guide/buddy` and `/docs/guide/creator` go for the same reason: guided
flows replace them.

`/docs/helper` is **kept** and rewritten. Its scope narrows honestly now that
WhatsApp owns the daily entry and the pages own the imports: Helper is for the
backlog — the two years of photographs already on a laptop — not for the
photograph taken tomorrow.

Plan: `docs/plans/2026-09-16-capability-split.md`.

## Work

**Delete** `app/docs/extract/page.tsx` and `docs/extract.md`; the `buddy` and
`creator` entries and `docs/guides/{en,de,hu}/{buddy,creator}.md`.

Remove the matching entries from `lib/docs.ts` and the ids from the
`DocsPageId` / `GUIDES` unions. Fix the inbound links at
`components/extract/ExtractHub.tsx:79` and
`components/extract/NonPhotoImport.tsx:167`.

**It is a locale change too**: `docs.extract.title`, `extract.hub.guideHint`,
`extract.hub.guideLink` and the two guide titles across en, de and hu.

Add 301s so old URLs converge instead of 404ing.

**Rewrite** `docs/helper.md` and its page as the self-hoster's page: what
Helper is for now, how to point your own agent at it, and what happens after it
writes a trip. `lib/api/documentation.ts:272` references this page and stays.

Keep the `guest` guide unless a separate decision retires it.

**Do not land this before B1824.** Deleting the guidance before the flows carry
it leaves people with neither.

## Acceptance

- The three pages are gone, their locale keys with them, and nothing links to
  them.
- Every deleted URL 301s to something useful.
- `/docs/helper` reads as a page for somebody self-hosting, and mentions no
  deleted guide.
- `npm run i18n:keys` is clean; knip reports no orphaned files.
- The rewritten page is looked at in a browser, not just diffed.
- `npm run verify` passes.
