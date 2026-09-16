---
id: B1723
title: Sixty-one task files have unparseable frontmatter, so they are invisible everywhere that reads docs tasks
type: ISSUE
priority: medium
complexity: low
area: docs, tasks, roadmap
found: "2026-09-14"
---

# B1723 — Sixty-one task files have unparseable frontmatter, so they are invisible everywhere that reads `docs/tasks/`

## Why

Found while building B1721. `/docs/roadmap` says it is showing **1,551**
tickets. `find docs/tasks -name '*.md' ! -name INDEX.md | wc -l` says
**1,673**. Sixty-one of the difference is this: `gray-matter` throws on their
frontmatter, `lib/roadmap.ts` logs a warning and skips the file, and the
ticket exists nowhere a reader can see it.

The cause is the same in every one — an unquoted `: ` inside the `title:`
value, which YAML reads as a second mapping pair:

```
title: POST /api/v1/{user}/import/dry-run: the route is gone
```

`lib/roadmap.ts` skipping rather than throwing is correct and stays; a page
that 500s because one of 1,673 files has a stray colon would be worse. The
defect is in the files.

This is not only the roadmap. Anything reading the frontmatter reads past
these — count them before trusting a number produced from `docs/tasks/`.

The sixty-one, as of 2026-09-14:

- `backlog/big-feature/B1595-inbox-day-assembly-land-phases-4.md`
- `backlog/issue/B1620-three-v2-surfaces-drop-information-v1.md`
- `backlog/superseded/B1023-npm-run-verify-fails-on-task.md`
- `backlog/superseded/B1050-main-does-not-build-a-merge.md`
- `backlog/superseded/B1125-every-photobook-print-quote-is-refused.md`
- `backlog/superseded/B14-postcards-cannot-address-themselves-from-the.md`
- `backlog/superseded/B1588-api-v2-document-oriented-required-or.md`
- `backlog/superseded/B176-a-closed-trip-cannot-be.md`
- `backlog/superseded/B848-the-traveller-figures-never-appear-on.md`
- `backlog/superseded/B910-knip-fails-on-main-defaultsizefor-in.md`
- `backlog/superseded/B983-the-send-flow-jumps-pressing-send.md`
- `completed/B1169-the-room-re-renders-and-shifts.md`
- `completed/B1181-the-operator-console-answers-the-wrong.md`
- `completed/B1186-a-transient-upstream-failure-reads-as.md`
- `completed/B1203-every-entry-in-the-operator-s.md`
- `completed/B1206-getting-a-credential-into-a-session.md`
- `completed/B1207-room-decisions-the-clean-app-restyle.md`
- `completed/B1208-room-decisions-header-identity-credits-and.md`
- `completed/B1209-room-decisions-the-account-sheet-with.md`
- `completed/B1210-room-decisions-the-bring-your-own.md`
- `completed/B1211-room-decisions-the-composer-rebuilt-textarea.md`
- `completed/B1212-room-decisions-conversation-rendering-bubbles-lists.md`
- `completed/B1213-room-decisions-honest-streaming-status-lines.md`
- `completed/B1214-room-decisions-the-preview-grows-a.md`
- `completed/B1215-room-decisions-the-phone-gets-a.md`
- `completed/B1216-room-decisions-files-drop-paste-progress.md`
- `completed/B1217-room-decisions-history-clean-titles-search.md`
- `completed/B1218-room-decisions-opening-and-follow-through.md`
- `completed/B1219-room-decisions-an-evening-reminder-during.md`
- `completed/B1220-room-decisions-platform-polish-pwa-hint.md`
- `completed/B1221-room-decisions-a-30-second-demo.md`
- `completed/B1239-the-retired-wizard-s-code-still.md`
- `completed/B1306-three-model-habits-dropping-the-rest.md`
- `completed/B1347-the-money-dashboard-under-counts-print.md`
- `completed/B337-a-day-with-no-location-renders.md`
- `completed/B420-delete-costs-always-answers-costspagegone-true.md`
- `completed/B584-a-journal-s-owner-does-not.md`
- `completed/B645-nothing-runs-a-photograph-through-the.md`
- `completed/B646-the-helper-s-review-page-previews.md`
- `completed/B647-publish-mjs-matches-a-day-by.md`
- `completed/B648-publish-dry-run-cannot-show-a.md`
- `completed/B649-a-day-s-time-is-the.md`
- `completed/B650-a-day-s-location-and-its.md`
- `completed/B676-the-urls-door-refuses-video-fetchimage.md`
- `completed/B690-post-api-v1-user-import-dryrun.md`
- `completed/B695-a-public-get-spawns-ffmpeg-api.md`
- `completed/B849-the-traveller-figures-never-appear-on.md`
- `completed/B974-live-search-analytics-outranks-costs-for.md`
- `testing/B1453-createjournal-still-writes-costs-enabled-into.md`
- `testing/B1587-api-v2-document-oriented-required-or.md`
- `testing/B1596-v2-plumbing-route-helper-incomplete-422.md`
- `testing/B1608-v2-core-documents-the-shared-write.md`
- `testing/B1609-the-figures-library-walking-figures-become.md`
- `testing/B1612-v2-trips-and-days-the-whole.md`
- `testing/B1613-v2-media-one-door-per-kind.md`
- `testing/B1622-v2-long-tail-money-purchases-ledger.md`
- `testing/B1623-v2-long-tail-social-invites-contacts.md`
- `testing/B1624-v2-long-tail-print-and-inbox.md`
- `testing/B1666-finish-decision-5-journal-level-features.md`
- `testing/B1680-the-owner-s-own-journal-is.md`
- `testing/B1683-live-instance-serves-500-on-three.md`

## Work

Quote the `title:` value in each file. `scripts/tasks.mjs` already quotes
`found:`, `completed:` and the rest; the same treatment for `title:` on write
is what stops the sixty-second.

Then a keeper: a test that parses every file under `docs/tasks/` and fails on
one that will not. `test/task-ids.test.ts` already walks the tree, so this is
an assertion in a walk that exists rather than a new file.

## Acceptance

- Every file under `docs/tasks/` parses; `/docs/roadmap` counts the same
  number as `find`.
- A new task written by `npm run tasks -- new --title "a: b"` parses.
- A test fails if any file's frontmatter does not parse.
