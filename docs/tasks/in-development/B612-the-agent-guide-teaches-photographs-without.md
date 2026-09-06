---
id: B612
title: The agent guide teaches photographs without saying one can be held back
type: DOCS
priority: high
complexity: low
area: agent guide, media
found: "2026-09-06T15:20:00Z"
started: "2026-09-06T15:19:28Z"
session: 0959df30-510b-43ee-8ed3-a20d82a13c45
claimed: "2026-09-06T15:19:28Z"
---

# B612 — The agent guide teaches photographs without saying one can be held back

## Why

B596 gave a gallery item a `visibility` label, and the write doors take it:
`visibility` beside `captions` on `POST .../media`, `photoVisibility` on a day
`PATCH`. Both are in `/openapi.json`. Neither is in the part of `/agent.md`
that an agent uploading photographs actually reads.

The only mention in the guide is one row of the frontmatter-to-API table, at
line ~1756 of ~1900 — a section about **migrating an existing journal to a
hosted instance**. The "Photographs and video" section, which is where an
agent goes when it has files to send, teaches `captions` at length and says
nothing about the label.

Found by driving a new journal onto a running instance (the `keep-the-contract`
procedure): the round trip works perfectly, and an agent reading the guide
end to end for the first time would never learn the field exists. AGENTS.md
says it in one line — "a field the code accepts and the document does not
describe is a field nobody outside will ever use" — and this is that, for the
one feature whose whole purpose is a person asking for a photograph to be held
back.

## Work

Add the field to the "Photographs and video" section of
`lib/api/documentation.ts`, beside the caption paragraphs it mirrors:

- `visibility` in the multipart example, so it is visible to a skimmer.
- A short subsection: the two values and the populations they mean, the
  narrows-only rule and why there is no `public`, that a labelled photograph is
  refused as a file rather than merely hidden from the page, and that the whole
  day is the trip's own `visibility` to decide rather than thirty labels.
- The **do not decide this yourself** line, which matters more here than for a
  caption: an agent cannot see who is in a photograph or whether they minded,
  so the label is only ever what the owner named.
- The `PATCH` route for changing one's mind, with `null` as the clear.

Not doing: a second copy in the migration table — the row there is correct and
is about what a *frontmatter* key is called, which is that table's subject.

**B613 rides along**, and deliberately: it is two words in a paragraph this
task rewrites the end of, and editing around a sentence known to be false
would be worse than fixing it.

## Acceptance

- `curl -s <base>/agent.md` shows `visibility` in the media request example and
  a subsection about it inside "Photographs and video".
- The narrows-only rule and the absence of `public` are both stated there.
- `npm run verify` green — `test/agent-interface.test.ts` reads this document.
