# Task 1.2 — your requirements

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


---

## The screens these components serve

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
4. Primary **"