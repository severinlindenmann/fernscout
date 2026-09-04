# W01 — Branding, identity, licence

**Roadmap:** K4, K5 (partial), M13, §0.2 · **Depends on:** nothing · **Wave B**

> **Superseded by [W25](W25-rebrand-fernscout.md).** This package shipped
> the *Reisepost* identity — the envelope mark, the name, the AGPL and
> trademark policy. The name turned out to be unavailable to ship under
> (`reisepost.ch`, `.com` and `.de` are all registered by other people),
> so the product is now **Fernscout**. The licence and trademark work here
> stands; the mark and the name were replaced. Kept as written rather than
> rewritten, because a plan that pretends it always said Fernscout is a
> worse record than one that shows the turn.

## Goal
The project is called **Reisepost**. Nothing in the repo says otherwise, it has
a licence, and it has an identity that works at 16px and on a book cover.

## Scope
- `package.json` name → `reisepost`; README rewritten around the project, not
  around one couple's trip.
- **LICENSE**: AGPL-3.0. Add `TRADEMARK.md` — plain language, unregistered mark
  (ROADMAP §0.6): the code is free, the name and logo are not, don't imply
  endorsement.
- **Logo + wordmark**, SVG, hand-authored (no raster). The name means "travel
  mail" — a postcard, a stamp, a postmark and a route line are all legitimate
  directions. Produce **three distinct directions** as SVG, pick one, keep the
  others in `docs/branding/`.
- Wire into the existing slots: `app/icon.svg`, `app/apple-icon.tsx`,
  `app/opengraph-image.tsx`, `app/manifest.ts`.
- Favicon must be legible at 16px — test it, don't assume.
- `CONTRIBUTING.md`, issue templates, and a licence header policy.

## Out of scope
Site redesign. This package changes identity assets and metadata only; the
existing layout, colours and typography stay exactly as they are.

## Acceptance
- [ ] Three logo directions exist as SVG; one is wired in
- [ ] Favicon legible at 16×16 (screenshot it)
- [ ] OG image renders with the new mark at 1200×630
- [ ] `LICENSE` (AGPL-3.0) + `TRADEMARK.md` present
- [ ] README describes Reisepost as a project anyone can clone
- [ ] No reference to the old working title anywhere outside `content/`
