# The Import You Can See — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the camera-roll import look and feel like the design it was built from — starting with the thing that is missing from every single screen: the photographs.

**Architecture:** One new route serves a resized derivative of a staged photograph, modelled line-for-line on the existing `inbox/[id]/thumbnail` route and its guards. Two shared components — a tile and a strip — then put photographs on every screen that talks about them. Everything after that is composition against a design file that already exists.

**Spec:** `.superpowers/sdd/b1803/design-v2.html` in this worktree — the actual 76KB design, twelve drawn screens across ten steps. **It is a file. Read it.** The last plan named it as its spec and described it in prose because I wrongly believed a subagent could not reach it; that single false assumption is the root of everything this plan exists to correct.

## Why this plan exists

The import works. Every route is gated, every rule is tested, a security pass over it came back clean. And the owner's verdict on using it was that it looks bad, which is correct, and the reason is structural rather than cosmetic.

**I planned behaviour and never planned experience.** Sixteen task briefs specified what each route answers, what each test asserts, which token each colour comes from. Not one of them said what a screen *shows*. Sixteen implementers each built the minimum that satisfied their brief, correctly, and the sum is sixteen minimal answers where the design was one composed thing.

The sharpest instance, and the spine of this plan: **there is no route that serves a staged photograph.** The security review noted approvingly that "no new route serves staging bytes/thumbnails over HTTP" and I read that as a win. It is the missing feature. The whole premise of this flow is *look at your photographs and tell me about them* — and there is nothing to look at. Every screen in the design has thumbnails on it. The app has none, anywhere.

So a person is asked "It's Tuesday morning in Hoi An and you took twelve photographs — what were you doing?" while looking at a wall of text. The question is good. It is unanswerable without the pictures.

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

# Phase 1 — The spine: photographs on screen

Nothing else in this plan matters if this phase does not land. Every later phase decorates screens that this one makes worth looking at.

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

### Task 1.2: The tile and the strip

**Files:** Create `components/extract/PhotoTile.tsx`, `components/extract/PhotoStrip.tsx`, `components/extract/PhotoViewer.tsx`; test `test/extract-photo-tile.test.tsx`

The design uses photographs in four shapes, and every screen uses one of them:

| Shape | Where | Drawn as |
| --- | --- | --- |
| Strip | day cards, the question screen | five square thumbnails in a row |
| Grid | the upload screen, the sample picker | 3–4 across, with a state badge |
| Hero | the preview, the third question screen | one wide image |
| Avatar | who came | one small square beside a name |

Build **one tile** that takes a size and an optional badge, and **one strip** that lays tiles out. Do not build four components.

**The viewer is the owner's own request and it is not optional.** Tapping a photograph opens it large. Without it a person cannot tell two similar photographs apart, which is exactly what they need to do to answer a question about a day. Keep it plain: the image, a close control, and left/right if there is more than one. `ConfirmPanel` is not the right pattern here; check whether the repository has a dialog primitive before writing one, and say what you found.

- [ ] Steps: test → fail → implement → pass → commit (`feat: a photograph tile, a strip, and a viewer`)

### Task 1.3: Put photographs on every screen that talks about them

**Files:** Modify `UploadStep.tsx`, `DayBoard.tsx`, `AskCard.tsx`, `PhotoChips.tsx`, `PreviewScreen.tsx`, `CreditsScreen.tsx`

Working screen by screen against the design:

- **UploadStep** — the grid of tiles with per-file badges (`✓`, `62%`, `iCloud`, `queued`, `!`). It currently renders a text list. The design's grid is the screen.
- **DayBoard** — a five-tile strip on every day card.
- **AskCard** — the strip above the question; a hero above the third question.
- **PhotoChips** — the photograph being edited, visible while editing it.
- **PreviewScreen** — a hero at the top, a strip per day card.
- **CreditsScreen** — the sample picker is a grid you choose from, not a list.

**Local thumbnails before upload.** Before a file reaches the server there is no URL for it; the browser can draw it from the `File` itself. Use that so the grid is populated from the moment photographs are chosen. Release what you create — an object URL held for 500 photographs is a leak the person feels as a slow phone.

- [ ] Steps per screen, committed in two or three coherent pieces rather than one enormous change.

---

# Phase 2 — The chrome that makes it a flow

### Task 2.1: The step indicator

Every screen in the design carries its position: `1 of 5`, `3 of 5`, `day 4 of 9`, `3 of 9 days told`. It is how a person knows the shape of what they are in — the same complex-form finding that justified the expectation setter.

One component, a segmented bar plus a label, used everywhere. **It is not a percentage**; it is "which of how many", and the day board's version counts days told rather than screens.

### Task 2.2: Selection, icons, and the primary button

- A chosen card carries a **yellow ring**, not a subtle tint. Two screens in the design turn on this and it is how a person knows what they picked.
- The choice cards carry icons — a microphone, lines of text, a camera, a pin.
- Primary buttons say where they go: **"Next: how you'll tell it"**, not "Continue". The design's labels are better than the app's and they are already written; take them.

---

# Phase 3 — The screens that are thinner than drawn

Each of these exists and is missing most of what the design gives it. Work from the design file per screen.

- [ ] **3.1 Upload progress** — the bar, the three chips (`76 done`, `6 coming from iCloud`, `~3 min left`), and the failure panel with its own explanation and retry. The measured iCloud finding is what the middle chip is for.
- [ ] **3.2 Day cards** — the status pill (`told` / `no place` / `not yet`), the weather line, the per-card progress bar.
- [ ] **3.3 The question screen** — the `FIRST` label, the waveform, the large microphone, "Listening · tap to pause".
- [ ] **3.4 Check the wording** — **a whole screen that does not exist.** The transcript with the uncertain word highlighted and tappable. Deepgram returns per-word confidence; use it rather than guessing which word to flag. This is the screen that stops a misheard place name becoming a published sentence.
- [ ] **3.5 Follow-up chips** — "Who took this one?", "What happened right after?", "Why this photograph?"
- [ ] **3.6 Who came** — the counter, the names, the suggestion drawn from what the person already said. **Figure drawing stays out of scope** — its own ticket, its own consent and cost story.
- [ ] **3.7 Preview and Ready** — the hero, the per-day strips, the summary rows.

---

# Phase 4 — Voice, properly

### Task 4.1: Ask which language before recording

**The infrastructure is already there and the UI never asks.** `SPEECH_LANGUAGES` in `lib/helper/speech.ts` is `["en", "de", "de-CH", "hu"]` — **Swiss German is already supported** — and `POST .../transcribe` takes an explicit `language` override, with a comment saying detection was deliberately rejected because it "fails silently for half the languages this exists for".

So: ask once, before the first recording, and carry the answer. Four options, in their own languages. Default to the journal's own locale, because that is the best guess available and the person can change it.

Say plainly in the report whether `de-CH` genuinely improves a Swiss German speaker's result or merely routes to the German model — read what `lib/helper/speech.ts` says about it rather than assuming, and if the file does not say, that is worth finding out before shipping a label that promises something.

### Task 4.2: Remember it

Once chosen, it belongs on the run's manifest beside `mode`, so it survives a resume and is not asked again.

---

## What is deliberately not here

- **Figure drawing from a photograph.** A model-drawing feature with its own cost and consent story.
- **Guided flows for GPS, contacts and statements.** They upload plainly now; guiding them is a separate plan.
- **A second renderer for the preview.** It links to the trip's real pages and must keep doing so.

## Self-review

**Coverage.** Every screen in the design file maps to a task: S1 and S2 shipped in B1797; S3 → 1.3 and 3.1; S4 shipped; S5 → 1.3 and 3.2; S6 → 1.3; S7 → 1.3, 3.3, 3.4, 3.5; S8 → 3.6; S9 → 1.3 and shipped; S10 → 3.7.

**The dependency that orders everything.** Phase 1 is first because every other phase decorates a screen that is not worth looking at until photographs are on it. Phase 3.4 is called out inside its phase because it is a missing screen rather than a thin one.

**The honest risk.** This is a lot of UI, and the failure mode of the last plan was that briefs specified behaviour and left composition unspecified. Every task here points at the design file and says which screen. If an implementer cannot tell what a screen should look like, that is a defect in this plan and I want to be told rather than have it guessed at.
