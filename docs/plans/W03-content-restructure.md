# W03 — Media into content/, de-personalise

**Roadmap:** A1, A5, A6, A8, A9 · **Depends on:** W02 · **Wave C**

## Goal
`content/` is the only directory holding anything personal. Someone clones the
repo, empties `content/`, fills it with their own, and has their own site.

## Scope
- **Move** `public/media/<trip>/…` → `content/trips/<trip>/media/…`. Serve via a
  route handler (needed later for signed private media anyway, W09/C8) or a
  build-time copy. Update `lib/entries.ts` gallery `src` resolution.
- **Media interface** (B4): one module for read/write/URL-building so swapping
  to S3-compatible storage later is a config change. VPS disk is the only
  implementation for now.
- **Derivatives vs originals**: `content/.../media/` holds web-sized images
  (≤2000px). Originals live wherever `MEDIA_ORIGINALS_DIR` points and are never
  committed.
- **De-personalise**: everything from `lib/site.ts` is already in config (W02).
  Grep for personal strings and remove.
- **`content.example/`** — a real demo trip, and `npm run seed:demo` copies it.
  The current demo content moves here; `content/` keeps the live trip.

## Acceptance
- [ ] **Test that fails the build**: grep for the travellers' names and the trip ids
      outside `content/` and `content.example/` returns nothing
- [ ] Site renders identically before and after the media move (compare routes)
- [ ] `rm -rf content && cp -r content.example content && npm run build` works
- [ ] No image over 2000px wide is served
