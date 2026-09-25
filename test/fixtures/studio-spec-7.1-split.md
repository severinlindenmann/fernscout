<!--
  B2251: verbatim excerpt of §7.1 (only, up to but not including §7.2) from
  docs/plans/2026-09-19-the-studio-implementation-spec.md, which is moving to
  the private harness. test/studio-reshape-day.test.ts checks B1879's own
  claim against this section — copied here rather than the whole plan, which
  the test never reads past §7.1.
-->

### 7.1 Move, split or merge — B1832

Named on the hub by what went wrong (*Something is filed wrong*), not by the
operation. Three operations sharing one preview.

- **Preview shows before and after**, stacked at phone width.
- **A reference sweep** lists everything holding the slug — trip cover,
  photobook layouts, postcard orders, the published permalink — each with what
  happens to it. A posted postcard is **not** updated, and the screen says so.
- **Split has no proposed cut** (revised by B1879: an attached day's media
  carries no per-photo timestamp on disk — `dayMediaItem` is
  `src`/`caption`/`visibility` only — so a "largest gap" default would have to
  invent a time nobody recorded, which this repository forbids). **The person
  places the cut directly**, on both the photographs and the prose — the new
  half arrives as a draft.
- **Merge across trips is refused**, and the refusal hands over the *Move* flow
  that would make it possible.
- **D2** — a published day that moves states both addresses, says the old one
  will stop working for everybody holding it, and requires an explicit confirm
  through `ConfirmPanel`. No redirect is written.

