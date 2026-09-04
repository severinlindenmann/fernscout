---
id: B210
title: MEDIA_ORIGINALS_DIR outside the content root writes a ../ chain into the photobook plan
type: ISSUE
priority: low
complexity: low
area: photobook, media
found: "2026-09-04T06:14:25Z"
started: "2026-09-04T08:20:03Z"
session: 7d30451d-0304-4631-8484-d96036fb11b4
claimed: "2026-09-04T08:20:03Z"
---

# B210 — MEDIA_ORIGINALS_DIR outside the content root writes a ../ chain into the photobook plan

## Why

Noticed while building B25, which made the photobook plan record paths
relative to the content root so two machines produce the same JSON.

`bookFile()` in `lib/photobook/source.ts` is `path.relative(contentRoot(),
absolute)`. For the default layout the original is
`content/<user>/trips/<trip>/originals/…`, so that is a clean relative path.
But `tripOriginalsDir` honours `MEDIA_ORIGINALS_DIR` (`lib/media.ts:49`) —
"another disk, usually" — and an originals directory outside the content root
comes back as `../../../mnt/photos/<user>/<trip>/day/01.jpg`.

Nothing breaks: `resolvePrintFile()` resolves it back, the book renders, and
no absolute path reaches the JSON, so B25's acceptance still holds. But the
plan stops being portable in the way B25 wanted it to be — the number of `../`
segments depends on where the content root happens to sit — and the string is
unreadable in a warning, which is the other job `file` now does.

Small: it only bites an instance that sets `MEDIA_ORIGINALS_DIR`, and only in
the plan JSON and the warning text.

## Work

**Decided: a discriminator, carried inside the handle.** A file under
`MEDIA_ORIGINALS_DIR` is recorded relative to *that* root behind a prefix
naming it — `originals:alex/asia-2026/day-one/01.jpg` — and everything else is
recorded relative to the content root exactly as before. `bookFile()` and
`resolvePrintFile()` in `lib/photobook/source.ts` are still the only two
functions that know a handle is a path.

Why this one, against the two alternatives the Why listed:

- **Accepting `../` and documenting it** fails the acceptance line it was
  written against, and not on a technicality: the string is
  `../fernscout-vault-x/…` from one content root and
  `../../../../fernscout-vault-x/…` from another, which the second test below
  demonstrates. A plan is a file somebody keeps, and B25's point was that the
  same input gives the same bytes. Documenting the `../` would have been
  documenting the defect.
- **A second root declared in the plan, with paths relative to it**, is the
  more general answer and is the wrong size for the problem. It puts a new
  top-level key in the plan JSON, which every reader of that file has to learn,
  in exchange for expressing one fact — "this came from the originals disk" —
  that a prefix expresses in nine characters. There is exactly one such root,
  it already has a name in the environment, and a plan that declared its
  absolute location would be putting back the machine-specific string B25 took
  out.
- **A `root:` field beside the path** is this decision, minus the reason it is
  written the way it is. `BookPhoto.file` is opaque to the planner, the
  placements, the renderer and the preview; a sibling field would have to be
  threaded through all four to reach the two functions that resolve it, and
  every one of those is a place a future caller can forget it. Inside the
  string, the handle stays one value that cannot be separated from its
  meaning.

The cost, stated: `resolvePrintFile()` on an `originals:` handle **throws**
when `MEDIA_ORIGINALS_DIR` is not set. Within one run the two cannot disagree
— the same process wrote the handle — so this is only reachable for a plan
built elsewhere, or with the variable since unset. It is loud on purpose: the
quiet alternative is looking for the file under the content root, not finding
it, and reporting the plate as a missing photograph. The renderer already
turns a throwing `loadImage` into a reported gap (`lib/photobook/render.ts`
`loadAll`), so a book still builds and still says what went wrong.

Two smaller things came with it:

- `mediaOriginalsRoot()` is now a named export of `lib/media.ts`, resolved to
  an absolute path, and `tripOriginalsDir()` is written in terms of it. The
  photobook needs the *root*, not one trip's directory under it.
- An originals directory that happens to sit *inside* the content root is
  written the plain way, unchanged. The prefix exists for the case where a
  relative path cannot be honest, and nothing else.

**Not doing:** putting the absolute path back. That is B25.

## Acceptance

- **With `MEDIA_ORIGINALS_DIR` set outside the content root, the plan's photo
  paths are readable and independent of where the content root sits.**
  `test/photobook-source.test.ts`, "originals kept outside the content root".
  The first test asserts the handle is `originals:alex/asia-2026/day-one/01.jpg`
  — no `..`, not absolute, not containing the vault's location — and that
  `resolvePrintFile()` finds the file and the original's own 4200px width is
  what the plan records. The second builds the same trip from a second content
  root at a different depth against the same vault and asserts the handle is
  identical.

- **A test covers it.** Four tests, in that describe block, using the fixture
  shape already there. Before the fix, three of them fail:

  ```
  × the plan names the originals root rather than climbing out of the content one
    expected '../fernscout-vault-Lw9e1W/alex/asia-2…' to be 'originals:alex/asia-2026/day-one/01.j…'
  × the same photograph gets the same handle from a content root somewhere else
    expected '../../../../fernscout-vault-3U3kqP/al…' to be '../fernscout-vault-3U3kqP/al…'
  × a plan built against a vault will not quietly resolve without one
    expected [Function] to throw an error
  ```

  The second failure is the acceptance line stated as a diff: same photograph,
  same vault, two content roots, two different strings.

## A note on how this landed (2026-09-04)

Built alongside B219 and B218 in one branch, and separated from them at the
merge: a parallel session fixed both of those on `main` while this work was in
flight, converging on the same `contentRoot()` change and a near-identical
`displayPath` helper. Theirs is what shipped. Only the B210 half — the
`originals:` prefix, `mediaOriginalsRoot()`, and the four tests — was carried
across, onto a branch cut from their merge. Nothing here depends on the
discarded half.
