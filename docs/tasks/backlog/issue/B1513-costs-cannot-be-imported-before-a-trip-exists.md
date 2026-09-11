---
id: B1513
title: Statement costs cannot be imported before a trip exists, and publish will not run until they are
type: ISSUE
priority: medium
complexity: medium
area: helper, costs
found: "2026-09-11T19:05:00Z"
---

# B1513 — Statement costs cannot be imported before a trip exists, and publish will not run until they are

## Why

Hit live on 2026-09-11, and it is a deadlock between two rules that are each
correct on their own.

- `statement-costs --apply` writes through the API. A trip that is not on the
  instance yet answers `404 unknown_trip`.
- `publish` refuses to start while `validate-content` reports an error, and *"the
  trip tracks costs and this day says nothing about it"* is an error on every
  day.

So: the costs cannot be applied until the trip is published, and the trip
cannot be published until the costs are applied. For a **new** trip — the
ordinary case, a journal's first import of a holiday — there is no order that
works.

The way out was to write the rows into the entry files directly with
`shared/costfile.mjs`, marking each `# bank` so a later re-import replaces them
rather than duplicating. That is the right end state, and nothing in the skills
points at it: `statement-costs/SKILL.md` documents only `--apply`, and the loop
it describes cannot be completed on a trip that does not exist.

The deadlock is invisible until you are in it. The dry run does not warn, and
the `404` says `unknown_trip` — true, and no help at all about what to do next.

## Work

Pick one; the first is the smaller change and keeps the folder as the source of
truth, which is what the rest of the helper assumes.

- **Write to the files.** `--apply` detects that the trip is not on the instance
  and writes the agreed rows into `entries/*.md` instead, `# bank` marked, then
  says so. The subsequent `publish` carries them up with everything else. This
  also makes `--apply` work with no network at all, which matches how the rest
  of the content folder behaves.
- **Or say what to do.** Keep the API path, and on `404 unknown_trip` print the
  order that works: publish with `--drafts` first, then apply, then publish
  again. Cheaper, but it leaves a two-pass dance in a skill that reads as
  one-pass.

Either way `statement-costs/SKILL.md` needs the order written down, because a
person reading it today cannot get to the end.

## Acceptance

- A statement can be imported into a trip that has never been published, in one
  pass, without `--skip-validate`.
- Rows written this way carry `# bank`, so a re-import replaces them and leaves
  hand-written lines alone.
- `SKILL.md` states the working order for a new trip.
