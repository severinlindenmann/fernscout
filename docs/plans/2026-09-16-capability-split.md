# The capability split, the redirects, and the order of work

*Written 16 September 2026, before the work. The record of intent, not of what
shipped.*

A styled version sits beside it as `2026-09-16-capability-split.html`. The
prose here is the authority.

Companion plans: `2026-09-16-whatsapp-day-funnel.md` (what WhatsApp keeps) and
`2026-09-16-import-onboarding.md` (what the pages take over).

## The diagnosis, already written down

B1803 says it about the camera-roll import, and the sentence describes the
WhatsApp agent equally well:

> The plan behind it specified behaviour and never specified experience.
> Sixteen task briefs said what each route answers, what each test asserts,
> which token each colour comes from. Not one said what a screen *shows*.

Forty tools, each correctly built to its brief, and no brief that said what the
conversation should feel like. These three plans are the missing briefs.

## The split

| Tool area | WhatsApp | `/agent` | Dedicated page |
| --- | --- | --- | --- |
| **days** — write, caption, publish | **the one job** | yes | none needed; the chat *is* it |
| **files** — attach, stage | today's only | full | the import flows |
| **trips** — create, edit, party | redirect | yes | **create page to build** |
| **money** — costs, rates, budget | redirect | yes | exists, plus the costs import |
| **readers** — invites, channels | redirect | yes | exists |
| **journal** — account, credits, keys | redirect | yes | exists |
| **printed** — postcards, photobook | redirect | yes | exists |

### What `/agent` is for now

The conversational fallback for everything that has an owner-only cookie, a
browser, and no dedicated page yet — money interviews, party and visibility
edits, reminders, print proposals. The long tail too varied to justify a screen
but too irreversible-adjacent for WhatsApp's phone-level trust.

**Its footprint should shrink every time a "to build" becomes a page.** When a
repeated action earns a form, prune the tool rather than keeping a parallel
path. `/agent` is not a second front door to the same features.

### The security boundary

Restricting what the model is *offered* is not a restriction. `switch_area`
advertises every area and can widen back to all of them, and a tool list is
advisory. Narrow the candidate areas before `pickArea()`, narrow
`switch_area`'s enum to match — and then **refuse in `runTool()` on caller
kind**, which is the only line that actually holds.

## The redirect table

Warm, one or two sentences, never apologetic, and always straight back to the
open day if there is one. The reply names the boundary and gives the link; it
never offers to try anyway.

| Intent | Destination | The reply |
| --- | --- | --- |
| Contacts upload | `/import/contacts` | "Contacts go in through your browser, where you can see who's on the list before anything's added — here you go: {link}" |
| Location history | `/import/location` | "Location history is the most private thing you own, so it only goes in through the browser: {link}" |
| Bank statement | `/import/costs` | "A statement's worth going through on a screen where you can see every line before it's sorted — here: {link}" |
| Old photos, in bulk | `/import/photos` | "For a whole trip's worth of photos, the browser flow is much faster than sending them one by one here: {link}" |
| Create a trip | `/trips/new` *(to build)* | "New trips get made on the web, where you can see the visibility choice properly: {link}" |
| Invite a buddy or guest | `/contacts` | "Adding someone is a page where you type their email and see exactly what they'll be able to read: {link}" |
| Postcard | `/postcards` | "Postcards are proposed and previewed on the web before anything's ordered: {link}" |
| Photobook | `/photobook` | "Photobooks are laid out and reviewed on the web first: {link}" |
| Delete something | `/delete` | "Deleting anything needs a confirmation email — start it here: {link}" — and never claim it is done |
| Credits or billing | `/account` | "Credits and billing live on your account page: {link}" |
| Change visibility | `/trips/[id]` | "Changing who can read a trip is worth doing where you can see the exact wording of each option: {link}" |
| Help | in thread | "I only handle one thing here: send me a photo and a line about today and I'll put it in your journal. Everything else — new trips, imports, printing, sharing — lives at {link}." |
| Unparseable | in thread | "I didn't follow that — I can take today's photo and a few words about it. For anything else, {link} has the rest." |

**None of these stage a file first.** A staged multi-file import living in a
chat thread is precisely the surface area being removed. One exception stays: a
contact card naming somebody on *today's* trip, which serves the job WhatsApp
keeps.

## The create-trip page

Today `create_trip` exists only as a tool rendered inside `/agent`'s chat.
There is no `/[user]/trips/new`; `app/[user]/trips/page.tsx` is a read-only
list. A redirect needs somewhere to land.

### What the tool actually takes

From `lib/helper/tools/areas/trips.ts` and `lib/tripWrite.ts`:

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | free text |
| `start`, `end` | yes | `YYYY-MM-DD` |
| `visibility` | no | `public` · `guest` · `private`; omitted inherits the journal's default |
| `accent` | no | `sky` · `yellow` · `green` · `coral` · `navy` |
| `tagline`, `intro`, `rates` | no | free text, or the sentinel `"none"` |
| `id` | never asked | derived from title + start year |
| `status` | does not exist | see below |
| `cover` | never asked | written after photos land |

**The optional four are not optional-and-silent.** The create route refuses a
submission that says nothing about accent, tagline, intro and rates — an
explicit decline is a recorded answer. So the form's Skip must write `"none"`,
not omit the field, or the page becomes *more* permissive than the chat path it
replaces.

### Two screens

**Screen 1** — title, first day, last day, and who may read it. Nothing else.

Visibility stays on screen one and is never worded by the page's own prose —
only the three canned labels say who can read it. Burying it is how "only my
daughter should read this" becomes a public journal, a mistake this project has
already made once (B923) and hunted a false negative for once more (B931).

Labels: *Public — anybody at all can read it* · *Guests — everybody you have
let into this journal* · *Private — only the people who were on the trip*.

**Screen 2** — card colour, subtitle, opening words, other currencies. Each
individually skippable, and Skip writes the sentinel.

**Success** — "*{title}* is made. There's nothing in it yet — the fastest way
to fill it is to message it on WhatsApp: send a photo and a line about the day."
Primary: go to the trip. Secondary: bring in old photos or a statement instead.
The page never dead-ends on an "add a day" button; that capability belongs to
WhatsApp now.

### The control not to build

**No "make this the current trip" toggle.** `deriveStatus()` in `lib/trips.ts`
already computes `current` / `upcoming` / `past` from the date range on every
read, and v2 `trip.json` stores no status field at all — `lib/tripWrite.ts`
accepts and ignores one. A toggle would resurrect exactly the bug the migration
retired: a flag that disagrees with its own dates, set in March and still
claiming "current" in November.

Say it once and add no control: *"Whichever trip's dates include today shows as
current — you never have to flip a switch."*

Where two trips' ranges both include today, `loadTrips()` picks the later
`start`. Disclose that on the confirmation screen rather than letting it resolve
invisibly — a notice, not a new control.

German copy: *Neue Reise* · *Ein Titel und zwei Daten reichen zum Anfangen.* ·
*Titel* · *Erster Tag* · *Letzter Tag* · *Wer es lesen darf* · *Weiter* ·
*Noch ein paar Dinge (alles optional)* · *Reise anlegen*.

Hungarian is not written; see the note in the other two plans.

## The docs cull

**Delete:**

- `/docs/extract` — `app/docs/extract/page.tsx` and `docs/extract.md`. The hub
  and each flow now teach at the moment of need.
- `/docs/guide/buddy` and `/docs/guide/creator` — the dynamic route's entries
  plus `docs/guides/{en,de,hu}/{buddy,creator}.md`.

Remove the matching `lib/docs.ts` entries and the ids from the `DocsPageId` /
`GUIDES` unions. Fix the inbound links at `components/extract/ExtractHub.tsx:79`
and `components/extract/NonPhotoImport.tsx:167`. Add 301s so old bookmarks
converge rather than 404. Remember the locale keys: `docs.extract.title`,
`extract.hub.guideHint`, `extract.hub.guideLink`, and the guide titles.

**Keep and rewrite — `/docs/helper`.** It becomes the self-hoster's page, and
its scope narrows honestly now that WhatsApp owns the daily entry and pages own
the imports. Helper is for the backlog — the two years of photographs already
on a laptop — not for the photograph taken tomorrow. Also referenced from
`lib/api/documentation.ts:272`, which stays.

## Sequencing

Packages, in dependency order. Parallel-safe ones are marked.

**0 · Fix the Android Timeline parser.** Small. Blocker — see
`2026-09-16-import-onboarding.md`. Blocks the whole location flow.

**1 · Rename `/extract` → `/import`, with redirects.** Medium, parallel-safe.
Five owner pages, nine API routes, the nav destination, the page gate, ~215
locale keys × 3, ~20 test files. Goes early not because it matters most but
because everything else touches the same files and rebasing a rename under
active feature work is the worst of both. **Coordinate with B1803**, which is in
development on `components/extract/*` right now.

**2 · Docs cull and the helper rewrite.** Small, parallel-safe, independent.

**3 · The create-trip page.** Small–medium, parallel-safe. Must land before the
funnel narrows, because that is when WhatsApp starts redirecting to it.

**4 · Finish costs and contacts.** Medium–large. The costs decide step calling
`applyCosts`; the contacts cookie door onto `readContactsFile`; and the
cookie-side inbox `GET` both WhatsApp doors need.

**5 · The onboarding skeleton on all four.** Medium. Needs 4 first — onboarding
wraps a flow that has to actually finish. **Overlaps B1797**, already in
testing.

**6 · The funnel itself.** Large, riskiest. Channel filter on the tool set, the
`runTool` refusal, the three `day.json` funnel fields, the redirect table, the
+20h nudge. Needs real conversation testing rather than the suite.

**7 · Publishing.** Nothing to do. It already works through `isHelperOwner()` on
the v1 helper route; the v2 route is unreachable from chat and making it
reachable means touching `mayActAsOwner`, a safety shape, for no user-visible
gain. **The recommendation is to do nothing.**

## Verification

A visible change is never verified by the suite alone. Per package:

- **Rename** — existing `test/extract-*.test.ts`, plus a redirect test. Browser
  check of old and new URLs at desktop and phone width, and the nav active
  state.
- **Docs** — `test/docs.test.ts` and knip. Visual check of the rewritten helper
  page.
- **Create trip** — form submit through to the existing route. Brand-new page,
  so browser verification at both widths, with no prior fixture to regress
  against.
- **Costs and contacts** — a test that posts valid rows and asserts a day gains
  costs; a contacts round trip. Then a real upload of a real test CSV and vCard,
  confirming the day and contact actually appear rather than a 200 coming back.
- **Onboarding** — the suite cannot judge whether a sequence reads as
  why → how → doors → peek → decide. Browser, both widths.
- **Funnel** — `test/helper-tool-areas.test.ts` token measurements must be
  re-run after shrinking the tool set. Assert a WhatsApp-channel turn never
  receives `printed` / `journal` / `readers` schemas, and that `runTool` refuses
  a disallowed tool under a WhatsApp caller even when forced. Not verifiable by
  curl; drive dispatch directly or use persona flows. Check `day.json` state
  survives a simulated 24-hour gap.
- Keep `test/publish-day-whatsapp-idempotency.test.ts` green and unweakened.

## Related existing tickets

Cross-reference rather than duplicate:

- **B1803** (in development, high) — the import talks about photographs the
  person cannot see. Same files as the rename.
- **B1797** (testing, high) — the import drops a person onto a bare file picker
  with no framing. This is the onboarding gap.
- **B1595** (backlog) — inbox day-assembly phases 4–5, same day-folder
  mechanism.
- **B1807** (testing) — staging has no size limit.
- **B1571** (backlog) — a full journal refuses costs and contacts imports though
  those kinds write nothing.
- **B1233** (backlog) — the trusted-caller seam has had no full security sweep;
  relevant to the `runTool` refusal.
- **B1238**, **B1043** — no model tool for describing photographs or notifying
  readers.

## Open questions

- Does `/agent` survive long-term, or is it explicitly a holding pen that
  shrinks to nothing as pages get built?
- Which of the overlapping tickets above get folded in rather than run
  alongside?
- Hungarian, across all three plans.
