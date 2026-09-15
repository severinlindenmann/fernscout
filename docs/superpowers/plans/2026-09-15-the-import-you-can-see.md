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

---

# The screen specifications

Every screen, exactly as the design draws it, extracted from the design file
rather than described from memory. `.superpowers/sdd/b1803/screens.txt` is the
machine-extracted version of this same table and is the tiebreaker if these
disagree; `design-v2.html` is the tiebreaker above both.

**Read the row for the screen you are building. Do not improvise around it.**
Where a string is quoted here it is the string — the design's copy was written
carefully and several sentences encode measured findings. Where a count appears
("1 of 5", "12 photographs") it is data, not decoration, and comes from the run.

## S1 — Add an old trip *(shipped in B1797; verify against this)*

Header `Add an old trip`, no back, no progress.

1. Title: **"Bring an old trip in from your photos."**
2. Sub: "Four things happen, in this order."
3. Four rows, label left, timing right:
   `1 · You choose photographs` / `5 min`
   `2 · We read what they know` / `1 min`
   `3 · You tell us about the days` / `3 min a day`
   `4 · You read it back` / `yours to keep`
4. Panel **"Where your photographs go"**, three statements: holding area outside
   the journal and the storage quota; unused photographs deleted within two days
   automatically; nothing visible to anyone until the person publishes it.
5. Primary: **"Start with my photos"**
6. Reassurance beneath: "You can stop at any point and pick it up later."

## S2a — Where it goes *(shipped; verify)*

Header `← Where it goes`, progress **`1 of 5`**.

1. Title: **"A new trip, or one you already have?"**
2. Card, selectable: **"Start a new trip"** — "We work the dates out from the photographs. You name it at the end."
3. Card: **"Add to a trip you have"** — "Photographs land on the days they were taken. Missing days get created."
4. Card, dashed, the most recent trip: `Vietnam & Cambodia` / `Jul 2019 · 14 days · your most recent`
5. Primary: **"Next: how you'll tell it"**

## S2b — How you'll tell it *(shipped; verify)*

Header `← How you'll tell it`, progress **`2 of 5`**.

1. Title: **"Would you rather talk or type?"**
2. Card with a **microphone icon**: "Talk it through" — "We show you a day and ask about it. You answer out loud; we write it down and you can fix the wording."
3. Card with a **lines icon**: "Type it" — "The same questions, with a keyboard."
4. Panel "Switch whenever you like" — "Every question takes either answer. Talk on the train, type in the café."
5. Primary: **"Next: choose photographs"**

**This is also where Phase 4's language question belongs** — see Task 4.1. It is
not in the design because the design predates the request.

## S3a — Choose photographs

Header `← Choose photographs` with the trip name at the right (`Vietnam`),
progress **`3 of 5`**.

1. Three rows, **above the picker**: `Photos and videos` / `HEIC · JPEG · PNG · MOV · MP4`; `Up to` / `500 at a time`; `Each one under` / `50 MB · video 500 MB`. Take the real numbers from `lib/validate/media.ts`; if they disagree with these, the code wins and say so.
2. Primary, large, with a **camera icon**: "Choose from your library"
3. Panel "Two things worth knowing": the iCloud sentence, then "About 15 a day is plenty."
4. Card with a **toggle**: "Keep the screen awake" / "A locked screen pauses the upload."

## S3b — Uploading *(the grid is the screen)*

Header `Uploading 120` with **`Pause`** at the right, progress `3 of 5`.

1. A progress bar.
2. Three chips: **`76 done`** (green), **`6 coming from iCloud`** (cream, with a download icon), **`~3 min left`** (plain).
3. **A grid of photograph tiles, four across**, each with a badge in its corner: `✓` done, `62%` in flight, `iCloud` fetching, `queued`, `!` failed.
4. Failure panel, coral: **"4 didn't make it"** / "The connection dropped partway. Everything else is safely up — these four just need another go." with a **"Retry those 4"** button inside it.
5. Reassurance: "Leave this screen open. You can lock the phone once it says done."

## S4 — What we found *(shipped; verify)*

Header `What we found`, progress `4 of 5`.

1. Title: **"120 photographs, 9 days."**
2. Sub: "Read straight out of the files — nothing guessed."
3. Five rows: `Dates` / `118 of 120`; `Places` / `104 of 120`; `Time of day` / `118 of 120`; `Weather` / `we can look it up`; `Who's in them` / `you'll have to tell us`.
4. Panel "The 16 without a place" — "They were saved from somewhere else — sent to you, or downloaded — so they never carried one. We'll ask about those days instead."
5. Primary: **"See my 9 days"**

## S5a — The day board

Header `← 9 days` with **"Done for now"** at the right, progress **`3 of 9 days told`**.

Per day card:
1. Date left (`Tue 2 Jul`), **status pill** right: `told` (green) / `no place` (coral) / `not yet` (cream).
2. **A strip of five photograph tiles.**
3. A summary line: `Hoi An · 12 photographs · 28°C, light rain` — place, count, **weather**. For a day with no place: "9 photographs · none of them know where they were".
4. A thin progress bar on cards not yet told.

Below: primary **"Tell me about Friday"** — it names the next day worth doing —
and the reassurance "Any order you like. We save as you go."

## S5b — Welcome back *(shipped; verify)*

Header `Welcome back`, no progress.

1. Title **"You're 3 days in."**, sub `Vietnam & Cambodia · left off on Friday 5 July`.
2. Rows: `Told` / `Tue, Wed, Thu`; `Left` / `6 days`; `Photographs held` / `120 · safe for 41 more hours`.
3. Panel "There's no hurry, but there is a clock".
4. Primary **"Carry on with Friday"**, secondary **"See all 9 days"**.

## S6a — One day's photographs

Header `← Tue 2 Jul`, count at the right (`12`).

1. **A grid of that day's photographs**, the selected one ringed.
2. Card "Photograph 1 of 12" carrying the chip row: `Hoi An` (green), `10:07` (green), `Who's in it?` (cream), `Add a caption` (cream), `Guests only` (plain).
3. Card "This day": `Hoi An · 12 photographs · 28°C, light rain`, with a coral `Describe this day` chip.
4. Primary **"Tell me about Tuesday"**.

## S6b — Who can see this

Header `← Who can see this`.

1. **The photograph, large.**
2. Three cards: **"Everyone"** — "Anyone with the trip's link — only if the trip itself is public."; **"Guests"** — "People you've let into your journal."; **"Just you"** — "Kept with the day, shown to nobody."
3. Panel "Set it for the whole day instead?" — "Apply to all 12 photographs from Tuesday."
4. Primary **"Save who can see it"**.

## S7a — The question

Header `← Tue 2 Jul · Hoi An`, **`1 of 3`** at the right, progress **`day 4 of 9`**.

1. **A strip of the day's photographs.**
2. The question card, dark, with a small yellow label **`FIRST`** above it and the question beneath.
3. **A waveform**, animated while recording.
4. **A large round microphone button**, coral.
5. "Listening · tap to pause".
6. Secondary **"Type this one instead"**.

## S7b — Check the wording *(does not exist; build it)*

Header `← Check the wording`, **`Redo`** at the right.

1. A large **pause** control, and "Paused · 1:12 recorded".
2. Card labelled **"WHAT WE HEARD — TAP TO FIX"** holding the transcript, with the uncertain word **highlighted in coral and tappable**. The design's example is a place name — `Ban Mi Fuong` — which is exactly the class of word that slips.
3. Panel "One word looked uncertain" — "Names and places are where transcription slips. Tap the highlighted bit to correct it."
4. Primary **"Looks right — keep going"**, secondary **"Say it again"**.

Deepgram returns per-word confidence; flag from that rather than guessing.

## S7c — One more, if you like

Header `← Tue 2 Jul`, `3 of 3`, progress `day 4 of 9`.

1. **One photograph, wide.**
2. Question card labelled **`ONE MORE, IF YOU LIKE`**: "You went back to that place more than once. What did it smell like in there?"
3. Three chips: `Who took this one?` · `What happened right after?` · `Why this photograph?`
4. Panel "Pick one or skip" — "These are the small ones that turn a day into something worth reading. None of them is required."
5. **"Skip"** beside **"Finish Tuesday"**, the second one primary.

## S8a — Who came

Header `← Who came`.

1. Title **"How many of you went?"**
2. A stepper: `−` / **2** / `+`.
3. Card "Names, if you'd like" with rows `You` / `Severin` and `Second` / `tap to name`, and beneath: *"You mentioned "Nora" on Tuesday and Thursday — is that them?"* — drawn from the person's own answers.
4. Primary **"Save who came"**, reassurance "Names are yours. They're never shown to anyone you haven't let in."

## S8b — Draw the two of you *(out of scope — do not build)*

Its own ticket, its own cost and consent story.

## S9a — A free one, first *(shipped; verify the grid)*

Header `← A free one, first`.

1. Title **"Pick any photograph."**, sub "We'll write its description now, free, so you can see whether it's worth the credits."
2. **A grid of photographs to choose from**, the chosen one ringed. This is the part that is currently missing.
3. Card "WHAT WE'D WRITE" holding the generated line, with chips `from your Tuesday` (green) and `rewrite it` (plain).
4. Primary **"Do this for all 120"**, secondary **"No thanks — use my own words"**.

## S9b — Finishing touches *(shipped; verify)*

Header `← Finishing touches`, **`180 credits`** at the right.

Three cards, each with its price as a chip and a **toggle**: "Describe all 120
photographs" (24), "Write the trip summary" (6), "Draw Severin and Nora" (4, off).
Then rows `This will cost` / `30 credits` and `You have` / `180 · 150 left after`.
Primary **"Spend 30 and build the trip"**, secondary **"Build it free from what I
wrote"**, reassurance "Everything written is editable afterwards. Nothing gets
published by this button."

## S10a — Preview

Header `← Preview`, **`Edit`** at the right.

1. **A hero image.**
2. Title `Vietnam & Cambodia` with a `Draft` pill; beneath it `2–11 July 2019 · 9 days · 120 photographs · Severin and Nora`.
3. Per day: `Tue 2 Jul · Hoi An` with an `edit` chip, the day's prose, **and a strip of its photographs**.
4. Secondary **"Keep editing"**.

## S10b — Ready *(shipped; verify)*

Header `Ready`. The waymark, **"Saved as a draft."**, "Nobody can see it — not
guests, not anyone with a link." Rows `Days` / `Photographs` / `Held back` /
`Credits spent`. Panel "Publishing is a separate decision". Primary **"Publish
this trip"**, secondary **"Leave it as a draft"**.

## Self-review

**Coverage.** Every screen in the design file maps to a task: S1 and S2 shipped in B1797; S3 → 1.3 and 3.1; S4 shipped; S5 → 1.3 and 3.2; S6 → 1.3; S7 → 1.3, 3.3, 3.4, 3.5; S8 → 3.6; S9 → 1.3 and shipped; S10 → 3.7.

**The dependency that orders everything.** Phase 1 is first because every other phase decorates a screen that is not worth looking at until photographs are on it. Phase 3.4 is called out inside its phase because it is a missing screen rather than a thin one.

**The honest risk.** This is a lot of UI, and the failure mode of the last plan was that briefs specified behaviour and left composition unspecified. Every task here points at the design file and says which screen. If an implementer cannot tell what a screen should look like, that is a defect in this plan and I want to be told rather than have it guessed at.
