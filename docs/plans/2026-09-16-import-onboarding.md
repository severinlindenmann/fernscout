# The import hub and its onboarding

*Written 16 September 2026, before the work. The record of intent, not of what
shipped.*

A styled version sits beside it as `2026-09-16-import-onboarding.html`, with
the screens drawn out. The prose here is the authority.

## The decision

All written documentation for importing goes. `/docs/extract` is deleted and
nothing replaces it. **The page teaches at the moment of need, or nobody
learns at all.**

Four import types — photographs, location history, contacts, bank statements —
wear one five-step shape, and only the last step writes anything.

The hub is renamed from `/[user]/extract` to `/[user]/import`.

## Before anything else: a live bug

**Android location exports are accepted and import nothing.**

Google moved Timeline onto the phone during 2024. Android and iOS now write
different files with different shapes. Both were fed to
`importers/gps/google-timeline.ts` on 16 September 2026:

```
iOS/documented         detect=true  fixes=1
Android Timeline.json  detect=true  fixes=0     ← accepted, imports nothing
```

The object wrapper is handled — `detect()` already matches `semanticSegments`
and `parse()` unwraps it — which is precisely why the file gets far enough to
fail silently. The cause is `parseGeoUri()` at `importers/gps/schema.ts:48`,
which requires a `geo:` prefix. Android writes `"35.0116°, 135.7681°"`.

Other divergences the parser will meet next: `placeId` vs `placeID`, numeric
values delivered as strings, and `visit.placeLocation` being a direct string
rather than nested under `latLng`.

**This blocks the location flow.** Writing careful step-by-step instructions
that send half the users to a file we silently discard makes the experience
worse, not better. Fix the parser first.

| | Android | iOS |
| --- | --- | --- |
| Filename | `Timeline.json` | `location-history.json` |
| Root | `{ "semanticSegments": [...] }` | `[...]` |
| Coordinates | `"45.4642°, 9.1900°"` | `"geo:45.4642,9.1900"` |
| Place id key | `placeId` | `placeID` |
| Numbers | numbers | strings |

Keep `google-records.ts` — people still hold pre-2024 Takeouts — but never
present Takeout as a path somebody can take today. Google Takeout no longer
produces location history.

## The five-step skeleton

1. **Why** — what this gets you, and what will never happen to it. The privacy
   promise lives *at the question*, not in a footer.
2. **Get it** — platform-tabbed steps, a screenshot per tap, naming the exact
   filename to expect.
3. **Deliver it** — two doors: send it on WhatsApp, or pick it here. Equal
   weight, same destination.
4. **Peek** — what we read, in real numbers, with an explicit statement that
   nothing has been written.
5. **Decide → write** — the check-answers screen. Every row changeable. The
   only step that touches the journal, behind a button named after what it
   does.

### Why this shape

- Wizards suit **unfamiliar, infrequent** work. A person imports a Timeline
  perhaps twice in their life. (NN/g, *Wizards*)
- Show the steps and highlight the current one; enforce order; allow exit and
  resume. `ResumeScreen` already does resume for photos.
- **Never a generic "Next".** Generic labels have weak information scent. Every
  button is named after its consequence.
- **Steps must be self-sufficient** — needing no information from elsewhere in
  the app. Measured against that rule, the `/docs/extract` link at the bottom
  of `ExtractHub.tsx` is not a helpful extra; it is the bug. This guideline is
  the whole argument for deleting the docs.
- **Check answers before submit** raises confidence and cuts errors; every row
  gets a Change link and the final button names the action. (GOV.UK Design
  System, *Check answers*)
- **Sensitive questions cause dropoff unless the promise is made at the
  question.** (NN/g, *Handling Sensitive Questions*) Location history gets its
  promise on the why screen and again on the decide screen.

Sources: <https://www.nngroup.com/articles/wizards/>,
<https://design-system.service.gov.uk/patterns/check-answers/>,
<https://www.nngroup.com/articles/sensitive-questions/>

## Per type

| | Photographs | Location | Contacts | Costs |
| --- | --- | --- | --- | --- |
| Why | Days write themselves from what you shot | A line on the map that is actually where you went | The people who were there, so they can be named | What the trip cost, in real numbers |
| Promise | Originals kept as print masters | **Never published.** The public map shows one clipped line | Nobody is contacted until they confirm themselves | Nothing leaves this server; no account linked |
| Peek shows | Thumbnails by day, how many carry GPS, date span | Fix count, date span, days covered, **extent only** | Name, email, who already exists, **who cannot be added** | Detected bank, first ten rows, span, problems |
| Decide asks | New or existing trip, which days, stays a draft | Which trips get a track, keep or discard the raw history | Guest or buddy, and which trips | Which trip, category per row, currency check |
| Write button | "Make these days (as drafts)" | "Draw the track for Japan 2025" | "Add 3 people and send their confirmations" | "File 47 costs to Japan 2025" |
| Built today | Full flow (`ExtractFlow.tsx`) | Writes, but no peek or decide | **Stub — stops at staged** | Reads and previews, never writes |

The location peek shows **an area, not a route.** Drawing the real track on
that screen would publish-by-accident the exact thing the why screen promised
not to show. Deliberate constraint, not a shortcut.

## How people get each file

Verified against vendor documentation, September 2026.

### Location history

**Android** — phone **Settings**, not the Maps app: Settings → Location →
Location services → Timeline → **Export Timeline data** → Continue → choose a
location → Save. Produces `Timeline.json`.

**iPhone** — Google **Maps app** → profile picture → Settings → **Location &
Privacy** (older builds: *Personal content*) → **Export Timeline data** → share
sheet → Save to Files. Produces `location-history.json`.

Source: <https://support.google.com/maps/answer/6258979>

### Photographs with location intact

- **macOS Photos** → File → Export → **Export Unmodified Original**. Full EXIF
  including GPS. Add an XMP sidecar for titles and keywords.
- **iCloud.com** → Download → **Unmodified Original**. The plain download
  button gives a converted copy.
- **Traps, in the order they bite:** the iOS share sheet's **Options →
  Location** toggle is per-share and one tap from off; AirDrop respects the same
  toggle; iCloud Shared Albums strip GPS and captions and are never a source;
  any chat app re-encoding an image strips EXIF. *Optimise iPhone Storage* does
  **not** strip EXIF — worth saying on screen, because it is widely
  misreported.
- **Google Photos Takeout** delivers stripped images plus a per-file
  `*.supplemental-metadata.json` carrying `photoTakenTime` and `geoData`. The
  location is there, just not in the image. Reading the sidecar is kinder than
  telling somebody to run exiftool.

### Contacts

Prefer **per-contact sharing** over a full export: this software only ever
wants the handful of people who were on the trip, and a 2,000-entry address
book is a privacy liability and a worse peek screen.

- **Android** — Contacts → long-press one to enter selection → tick the others
  → Share. One `.vcf`.
- **iPhone** — cannot share several at once. Either one at a time, or
  icloud.com → Contacts → select → gear → Export vCard.
- **Google Contacts** — contacts.google.com → select → Export → vCard.

### Bank statements

**Revolut** — app: Accounts → the account → ⋯ → Account statements → date range
→ Excel/CSV. Web: Home → account → Statement → Excel. Per-currency-account; the
PDF is the official statement, the CSV is the machine one.

Worth supporting next: **Wise** (the other traveller default), **N26**, and
**CAMT.053 XML**, which is a standard and would cover many Swiss banks with one
parser. The generic column-mapping fallback in `importers/costs/mapping.ts`
stays the real answer for the long tail.

## The two doors

The file is on the phone; the screen is on the desk. That split is why both
doors exist. Inbound WhatsApp media already lands in `content/<user>/inbox/`
within seconds, so this needs almost no new plumbing.

- The link is `wa.me/<number>?text=…` — one tap on a phone, a QR code on
  desktop captioned "scan this with the phone that has the file".
- Prefilled text, deliberately short because WhatsApp shows it in the compose
  box and people edit it: *"Fernscout: here is my Timeline export"*,
  *"Fernscout: these are the people"*, *"Fernscout: here is my statement"*,
  *"Fernscout: photographs for my journal"*.
- **Always, in bold, under the button:** attach with the paperclip →
  **Document**. Sent as a photo, the file is re-encoded and the location is
  thrown away. `lib/whatsapp/dispatch.ts` already documents this asymmetry.
- The page records `openedAt`, polls every three seconds, and takes the first
  file arriving after that with a matching extension. After about ten minutes
  it stops and says so, offering the browser door.

**One route to build.** `listInbox()` exists in `lib/inbox.ts`, but only the
bearer-token `GET /api/v2/<user>/inbox` exposes it. The cookie-side twin is
roughly ten lines and is the only new plumbing either door needs.

No pairing token. Two simultaneous imports on one journal is not a real case
and a four-character code is a thing to type. Add one if inbox races actually
appear.

## The name

`/[user]/import`. The word every app the person just came from uses — Photos,
Contacts, their bank. Zero teaching cost, and it works as a noun in all three
locales (*Import* / *Import* / *Importálás*).

Rejected: **Bring in** is warmest and matches the current heading, but has no
usable noun in German or Hungarian — *Behozatal* reads as customs. **Collect**
is wrong for a bank statement and implies the software goes and fetches.
**Add** already means "add a day" and collides.

Keep the warmth in the heading, which is free to be a sentence: *"What do you
want to bring in?"* / *"Was möchtest du mitbringen?"*

## Screen copy — location history

**L1 Why.** *Where you actually went.* — Your phone has been quietly keeping a
line of where you were. Bring it here and your trip gets a real map — the roads
you took, not a straight line between two hotels. **This is the most private
thing in your journal, and it is treated that way.** The full history is never
published, never shown to a visitor, and never leaves this server. What
visitors see is a single line for one trip, trimmed to that trip's dates and
nothing else.
Buttons: `Show me how to get it` · `Not now`
Visual: two small maps side by side — straight dashed line, greyed; then the
same following real roads. Caption "Without · With".

**L2 Get it.** *Get the file off your phone.* — Google moved this onto your
phone in 2024 — it is not in your Google account any more, and Takeout will not
give it to you. It takes about twenty seconds on the phone itself. Then the
two platform tabs above, ending with the filename to expect.
Buttons: `I have the file` · `I cannot find it`
Visual: three cropped phone screenshots, one yellow ring each on the thing to
tap. No arrows, no numbers on the image — the list carries that.

**L3 Deliver it.** *Send it over.* — Two ways. Both end up in the same place.
Then the two door cards, then the waiting state: *"This page is watching. It
appears here by itself."* with `⟳ nothing yet` and *"Sent it and nothing
happened? Pick the file here instead."*

**L4 Peek.** *Here is what we read.* — **41,207 positions**, from **12 March
2025** to **28 March 2025**. That covers **14 of the 16 days** of *Japan 2025* —
and no day of any other trip. **Nothing has been written yet, and nothing is
visible to anyone.** This is a read.
Failure variant: *We could not read that file.* — It came through as
`photo_2025.jpg`, which is a picture, not a Timeline export. On WhatsApp,
attach it with the paperclip and choose Document — sending a file as a photo
changes it. Every failure names the likely cause and the way back.

**L5 Decide.** *What happens to it.* — Tick the trips that get a track; each
line is trimmed to that trip's own dates. Then one choice for the rest: keep it
privately on this server, or throw it away after drawing the tracks.
Button: `Draw the track for Japan 2025` — generated from the choice.

**L6 Done.** *Japan 2025 has a map now.* — A 340 km line across 14 days. It
shows on the trip page as soon as you publish that trip — it is not visible to
anyone yet, because the trip is not. Your full history is kept privately.

German headlines: *Wo du wirklich warst* · *Hol die Datei von deinem Handy* ·
*Schick sie rüber* · *Das haben wir gelesen* · *Was damit passiert* ·
*Japan 2025 hat jetzt eine Karte*

## Screen copy — contacts

**C1 Why.** *The people who were there.* — A journal reads better when the
people in it have names. Bring in a few contacts and you can say who was on a
day, and later send them a postcard or a link — if they want one. **Nobody here
is contacted because you added them.** Everyone you add gets one mail asking
whether they want anything at all, and nothing is ever sent to them until they
say yes themselves.

**C2 Get it.** *Just the people from the trip.* — You do not need your whole
address book here — and you should not bring it. Then the three platform tabs.
Quiet line: a contact without an email address cannot be added — a contact here
is kept by its address.
Visual: the **multi-select state** must be shown, not described. It is the
thing people cannot find on their own.

**C3 Deliver it.** As L3, plus: you can also forward a contact card straight
from WhatsApp — that works too.

**C4 Peek.** *Seven people on that card.* — Tick who was actually on the trip.
Rows show name, email, who already exists (ticked, disabled), and **who has no
email and therefore cannot be added** — greyed, with the reason inline,
**never silently dropped**. A person who exported seven and sees three must be
told what happened to the other four.
Empty variant: *Nobody on that card has an email address.*

**C5 Decide.** *Who they are to this journal.* — Per person: was on the trip
(can be named on a day, can be sent things) or just gets to read it (receives a
link, appears nowhere in the journal); and which trips. Then, plainly: **what
happens when you press the button** — each gets one mail asking whether they
want anything from this journal, and until each answers they receive nothing
else.
Button: `Add 3 people and send their confirmations`

**C6 Done.** *Three people added, three mails on the way.* — None of them is a
recipient of anything until they answer it themselves.

German headlines: *Die Leute, die dabei waren* · *Nur die Leute von der Reise* ·
*Schick sie rüber* · *Sieben Personen auf dieser Karte* · *Wer sie für dieses
Journal sind* · *Drei Personen hinzugefügt, drei Mails unterwegs*

## Hungarian

Not written. The Hungarian drafts produced while researching this were not
checked against the register `site/locales/hu.json` already establishes, and
AGENTS.md forbids shipping an invented translation. **Every Hungarian string in
this work is a hand-off to a speaker.**

## What this breaks against in the repo today

1. `importers/gps/google-timeline.ts` silently drops Android exports — above.
2. No cookie-side inbox listing; `GET /api/helper/[user]/inbox` does not exist.
3. Contacts genuinely stop at "staged" — `readContactsFile` is reachable only
   through the bearer-token `POST /api/v2/<user>/import`.
4. Costs never call `lib/statements/apply.ts`. `validateRows` wants a `label`
   and a `category` per row, which no screen collects.
5. `ExtractHub.tsx:79` and `NonPhotoImport.tsx:167` link to `/docs/extract`;
   `docs.extract.title`, `extract.hub.guideHint` and `guideLink` exist in all
   three locales. Deleting the docs is a locale change too.
6. Roughly 215 `extract.*` locale keys across three files get renamed with the
   route. Run `npm run i18n:keys` after.

## Open questions

- Should Google Photos Takeout sidecars be read automatically?
- Which banks after Revolut — Wise, N26, CAMT.053?
- Who maintains the screenshots? Google moved this export once already, and a
  screenshot that lies is worse than prose.
