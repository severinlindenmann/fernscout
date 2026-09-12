---
id: B1606
title: "Content on disk becomes JSON — the document, stored as itself"
type: CHORE
priority: high
complexity: medium
area: API v2
found: 2026-09-12T00:00:00Z
merged: "2026-09-12T18:03:19Z"
---

## Why

`docs/v2-migration/00-decisions.md` decision 4 said *"Storage stays markdown;
JSON is wire-only."* **The owner overruled that on 2026-09-12**, having seen
both files side by side. Content on disk becomes JSON: the file IS the
document, with no frontmatter, no body, and no format translation at all.

What it buys:

- The serializer collapses to `JSON.parse`/`JSON.stringify`. A whole class of
  bug becomes unreachable rather than merely tested — the `---`-at-the-start-
  of-prose data loss (B1604) could not have existed, and neither could YAML's
  scalar coercion, its quoting rules, or `gray-matter`'s habit of re-parsing
  the body it is handed.
- Disk and wire are the same shape byte for byte, so round-trip losslessness
  is a property of the format rather than a test that has to keep catching up.
- The three trip files become one. `trip.md`, `costs.md` and `plan.md` were
  three files for exactly one reason — each had a real prose body, and a
  folder a person reads should keep prose as prose. With JSON that reason is
  gone, and `costs` and `plan` are already *sections of one document* on the
  wire. One fact, one address.

What it costs, stated plainly because it is a real loss: **the prose stops
being prose on disk.** `"content": "We left Zurich late...\n\nAt the top..."`
is not something a person opens in a text editor and reads, and a git diff of
one edited sentence is one changed line. The first sentence of `AGENTS.md` and
of the README — *"the content is markdown and photographs in a folder the
author owns"* — stops being true and must be rewritten (phase 4).

The markdown twin at `GET /<user>/day/<slug>.md` is unaffected and becomes
more important: it is now the only place a day is readable as prose without
this software rendering it.

## Work

- `lib/api/v2/markdown.ts` → `lib/api/v2/documents.ts`: `dayToJson`,
  `dayFromJson`, `tripToJson`, `tripFromJson`. Still pure — no fs, no
  `server-only`.
- `trips/<id>/entries/YYYY-MM-DD-slug.md` → `.json`; `trip.md` + `costs.md` +
  `plan.md` → one `trip.json`. Days stay one file each; they are separate
  documents with their own slugs, written through their own route.
- Deterministic bytes: fixed key order, two-space indent, trailing newline. A
  diff in git must mean a change in content.
- **No schema changes.** If something does not fit, that is a finding, not a
  licence to widen.
- Carry across every doc comment that is still true (the one-`weather`-key
  reasoning, the disk-only extras, the retired v1 keys, and above all the
  `status` asymmetry — an unrecognised status reads as draft, never
  published). Delete the ones that were about YAML, but say in the module
  header that this used to be a markdown serializer and why it is not one now,
  so nobody reinvents the frontmatter path.

Not doing: touching v1's readers. They still use `gray-matter` and still read
the old files, and they are B1598's problem — which this makes larger, not
smaller.

## Acceptance

- A day and a trip round-trip losslessly through JSON, including hostile
  strings, an empty body, and content that is exactly `"---"` (the case that
  used to destroy data).
- Serialising the same document twice gives byte-identical output.
- Nothing under `lib/api/v2/` imports `gray-matter`.
- `docs/v2-migration/06-contract-deltas.md` records the change and states that
  no schema moved.
