# Task 1.1 — your requirements

Exact values and signatures are binding.

## Global Constraints

- **Nothing is invented.** No weather, place, person or measurement the person or a file did not supply.
- **Nothing publishes.** `test/extract-no-publish.test.ts` guards it; do not defeat it.
- **Owner routes only**: `isEnabled("extract", user)` → 404, then `isHelperOwner` → `notYourJournal`. Cookie, never bearer.
- **A derivative, never an original.** Originals are print masters and never go on the wire.
- **Real `en`/`de`/`hu` for every string**, then `npm run i18n:keys`. A count beside a noun needs `tn()` and a `.one` entry.
- **Tokens, never literals.** `bg-action-strong`/`text-on-action` for primaries; the hues are dark-aware since B1798 and a raw Tailwind colour is a defect.
- **No `window.confirm`, `alert` or `prompt`.**
- Final gate `npm run verify`, foreground, `timeout: 900000`.
- **Verify visually at 390px in dark**, with real content on screen — not an empty state. Two bugs in this feature were missed by photographing a resting screen.


---

### Task 1.1: A route that serves a staged photograph

**Files:** Create `app/api/helper/[user]/extract/thumb/[run]/[id]/route.ts`; test `test/extract-thumb.test.ts`

**Read first, and copy its shape and its reasoning:** `app/api/helper/[user]/inbox/[id]/thumbnail/route.ts`. It solves the identical problem for the undated inbox — owner-only, id resolved through a lookup rather than joined into a path, a resized derivative rather than the original, `private, no-store` because the same URL answers differently per journal. Its doc comment lays out each guard and why. **Yours is the same route against a different store**, so it should read as a sibling, not as a new invention.

- [ ] **Step 1: Write the failing tests**

Four cases, each one a guard the inbox route already documents:

```ts
// a stranger gets 404, never 403 — a 403 confirms something is there
// another journal's real run id resolves to nothing under this username
// a traversal id (`../../../etc/passwd`) collapses and finds nothing
// the owner gets image bytes, and the response is `private, no-store`
```

- [ ] **Step 2: Run them, watch them fail** — `npx vitest run test/extract-thumb.test.ts`

- [ ] **Step 3: Implement**

`readStagedFile(username, runId, id)` is the lookup; it already applies `path.basename(id)` and `runDir`'s segment validation throws on a bad run id. Resize with `resizedCopy` and `parseWidth`, exactly as the inbox route does. A video has no still to serve — return a 404 and let the caller draw a placeholder; do **not** invent a poster frame.

- [ ] **Step 4: Run them, watch them pass**

- [ ] **Step 5: Commit** — `feat: serve a thumbnail of a staged photograph`

