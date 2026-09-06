---
id: B533
title: There is no section for moving a journal that already exists onto a hosted instance
type: DOCS
priority: medium
complexity: low
area: agent.md
found: "2026-09-06T09:55:00Z"
started: "2026-09-06T07:53:28Z"
merged: "2026-09-06T08:19:49Z"
---

# B533 — There is no section for moving a journal that already exists onto a hosted instance

## Why

The guide has "A folder of photographs, all at once". It has nothing for the
run that actually happened: **a journal that already exists in the content
format, being moved onto a hosted instance** — days on disk, frontmatter
written, photographs beside them.

That agent read the entries through a filter of its own making, printed title,
date, place and coordinates, and wrote 14 days from what its own filter had
shown it. `costs:` was on seven of those days and in none of its output. The
agent's own account of it: *"a field table from the content model to the API
would have forced me to look at every frontmatter key rather than the ones I
remembered."*

## Work

- A section for the migration, in the guide: read every key of the
  frontmatter, not the ones you recall; one day end to end; and the check that
  it landed, which is reading the day back.
- **A table from frontmatter key to API field**, generated from the same
  definitions the rest of the guide renders rather than typed out, so it
  cannot drift. It also has to name the keys that do *not* cross —
  `status: draft` is the publish call, `gallery:` is the media call.
- The reconciliation, said once: what to compare after the batch to know it is
  all there — `from` on the gallery items (B527), the cost lines per day, the
  count of days against the folder.

## Acceptance

- The guide has a migration section, and it names `costs`, `translations` and
  `gallery` as the three things an agent reading its own summary will drop.
- A test asserts the table covers every editable day field.
- `npm run verify` green.
