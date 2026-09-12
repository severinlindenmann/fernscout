# Inbox day-assembly: everything lands in the inbox, a day gets proposed once nothing is missing

Written before the work, as intent — not updated to match what ships (per
`docs/README.md`'s own rule for `docs/plans/`; this is its cousin under
`docs/superpowers/specs/`, same convention).

**Revision note:** this replaces the first version of this spec. The first
draft invented a parallel three-state tracking file (`declined.json`) and a
new day-readiness type from scratch. Reading `lib/tracks.ts` closely changed
that: this codebase already has an extensible, three-answer field registry
(`TRACKS` — value, declined, "asked and nobody knows"), already used for
`costs`, `coordinates` and `photos`, and already the stated model for
anything like it ("the weather feature being built alongside this is the
next row"). This version builds on that registry rather than beside it.

## Motivation

Today, making a day is a sequence of separate, model-driven writes: a person
uploads photographs (into the flat, undated inbox), says "put these on
yesterday" (`attach_files`), then separately says what happened
(`draft_words`), and separately again is asked about weather or costs if at
all — each its own sentence, its own tool call, with the person carrying the
shape of "what a day needs" in their head, and enough back-and-forth that a
gathering session can end with nothing actually written.

The wanted shape: everything the person has for a day — photographs, a
location pin, a shared contact, a voice note transcribed to text, a bank
statement — lands in one place regardless of when it arrives or in what
order, tagged to a date once that is known. The agent gathers, asking only
for what a `TRACKS`-style check would still call missing, **before**
committing to a real entry — so the day is created once, already complete,
rather than incrementally patched across a dozen turns. The person answers
each field once: *here it is*, *no, skip it*, *nobody knows*, or (where a
lookup exists) *look it up for me*.

## Scope and phasing

Five independently shippable pieces. Later phases depend on earlier ones
existing, not on each other's internals.

| Phase | What it adds | Depends on |
| --- | --- | --- |
| 1 | New inbox content: a browser "share my current location" button; WhatsApp location pins and shared contacts land in the inbox instead of their current auto-actions; EXIF read from an uploaded photograph | Nothing new — extends `lib/inbox.ts` |
| 2 | `inbox/days/<date>/` — a per-date staging folder, and a `day.json` readiness record that speaks the same vocabulary `TRACKS` already does | Phase 1 |
| 3 | The conversation: survey a date folder, ask only what is still missing, create the day once — not incrementally | Phase 2 |
| 4 | A persistent statement store (mirrors `gps/`) so a bank statement imported once can answer costs for days written weeks later | Nothing new — parallel track, phase 3 degrades gracefully without it |
| 5 | Wiring `gps/`'s existing history as the "extract" source for a day's location | Phase 2 |

Phase 4 is the only wholly new subsystem; everything else extends what is
already on disk or in `lib/tracks.ts`. Build in this order.

## Phase 1 — new inbox content

### Browser: "share my current location"

A button beside the composer, next to the attach-files control (paperclip).
Presses `navigator.geolocation.getCurrentPosition()` (the browser's own
permission prompt is the whole of the consent surface — no custom dialog).
On success:

- Reverse-geocode the coordinate the same way `lib/whatsapp/dispatch.ts`'s
  `handleLocationPin` already does (`reversePlace`, gated on the
  `addressLookup` capability); absent that capability, store the raw
  coordinate with no place name, the same degradation WhatsApp already has.
- Store it through `storeInboxFile` with a new `kind: "location"`. The
  bytes are a small JSON blob (`{ lat, lon }`); the sidecar's existing
  `lat`/`lon` meta fields (`InboxMeta`) carry the coordinate for anything
  reading the sidecar without the bytes.
- Undated by default, same as a photograph, until tied to a date.

### WhatsApp: location pins and contact cards, rerouted

`handleLocationPin` (`lib/whatsapp/dispatch.ts:628`) currently edits an
existing day's `lat`/`lng` directly, or creates one with `weather: true`
set — immediately, no selection step. Change it to call the same
`storeInboxFile` path the browser button uses, tagged `source: "whatsapp"`
(a field `InboxMeta` already carries), dated to the message's own date —
WhatsApp already knows the date from the message timestamp, so this one
files straight into the date's staging folder (phase 2) rather than landing
undated.

`handleContactCard` (`lib/whatsapp/dispatch.ts:732`) currently loops
`message.contacts` and creates a guest invite immediately for anyone with an
email. Change it to store each contact as `kind: "contact"` instead — the
vCard's own bytes, with name/phone/email parsed at import time into the
sidecar (reading a vCard's own fields is not invention; nothing is guessed).
**The guest-invite capability does not disappear** — it becomes a
deliberate proposal on the stored contact ("invite Maria as a guest?"),
shaped like `attach_files`, rather than an automatic side-effect of sharing
the card at all. This is a real behavior change on a shipped feature (B1074)
and gets its own Why section, not a line buried in this phase's diff.

### EXIF, as a named, sourced exception

`lib/inbox.ts`'s own rule today: *"Nothing on a sidecar is inferred...
`lat`, `lon`, `takenAt`... are what somebody said."* This phase carves out
one exception, deliberately, rather than quietly reversing the rule: EXIF
GPS and capture time are a real measurement the camera itself embedded, the
same kind of fact weather's own `source` field already exists to credit
honestly rather than hide. `storeInboxFile` reads EXIF at upload time (for
`media` kind only) and, when present, fills `lat`/`lon`/`takenAt` —
**tagged**, mirroring `DayWeather.source`'s own pattern: a new
`InboxMeta.locationSource`/`takenAtSource` (or one combined
`measuredFrom: "exif"`) field so every later reader can tell "the camera
said so" apart from "the person said so." Nothing downstream (a day's own
`weatherAsked`-style honesty checks) may present an EXIF-sourced value as if
the person supplied it in words.

### `lib/inbox.ts` changes

- `INBOX_KINDS` grows two entries: `"location"`, `"contact"`.
- `INBOX_FILE_EXTENSIONS` already carries `.vcf` — no extension change
  needed for contacts, only the new `kind`.
- `InboxMeta` grows the EXIF-source tag above, and a new
  `descriptionAsked?: boolean` — mirroring `Entry.weatherAsked` exactly:
  present and `true` means "asked about a caption for this photograph and
  they said no or don't know," absent means "not asked yet." `caption`
  itself already exists on `InboxMeta` and is the answered state; this adds
  only the "asked and there is genuinely none" state weather already has a
  name for.
- `components/InboxFileGroups.tsx` gains a third visual group — `location`
  and `contact` items render with their own icon instead of the generic
  document icon a `.vcf` currently falls back to.

## Phase 2 — the day folder and its readiness record

### Data model

```
content/<user>/inbox/
  media/ files/                    unchanged: undated content
  days/
    <date>/
      media/ files/                same shape as the top-level inbox —
                                    tying an item to a date is moving its
                                    file + sidecar here
      words.md                     accumulated prose — see below
      day.json                     the readiness record
```

**`day.json` speaks the vocabulary `lib/tracks.ts` already defines, rather
than inventing a new one** — this is the whole revision from the first
draft. Every field that already has a home in `Track`/`without`/`unrecorded`
uses exactly that shape; only fields with no existing per-day tracking
(`weather`, image captions) get a same-shaped pair alongside it.

```json
{
  "without": ["costs"],
  "unrecorded": [],
  "weatherAsked": false,
  "photos": ["a3f1c2-sunset.jpg"],
  "location": { "lat": 46.02, "lon": 7.75, "source": "browser" }
}
```

`without`/`unrecorded` here are **the same values `lib/tracks.ts` already
defines** (`Track = "costs" | "coordinates" | "photos"`), so turning this
record into the real entry's frontmatter once phase 3 creates it is a
direct copy — `withoutLine`/`unrecordedLine` already know how to render
them, unchanged. `weatherAsked` mirrors `Entry.weatherAsked` the same way.
Nothing in `day.json` claims a value a directory listing or `words.md`
itself could already answer (photographs actually present, words actually
written) — those stay derived, read straight off the folder, the same
principle `lib/helper/draft.ts`'s own header states today.

### `words.md`

Plain markdown, one `updatedAt` stamp, no other frontmatter. Every new
sentence or transcription appends a paragraph; nothing here is ever
silently overwritten. When the day is created, this file's body becomes the
entry's initial `content:`.

### What this means for `lib/helper/draft.ts`

Unchanged in shape, extended in content. `stepFor`/`isWritten` still answer
for a day that already exists as a real entry; this phase's `day.json`
answers the question that comes *before* that — whether there is enough to
create one at all. The two hand off at exactly one point: phase 3 creating
the entry is the moment `day.json`'s answers become the entry's own
`without`/`unrecorded`/`weatherAsked` frontmatter, and `lib/helper/draft.ts`
takes over from there precisely as it does for a day started any other way
today.

## Phase 3 — the conversation

### What "missing" means, extended

The trip's own `tracks:` (`Tracks`, unchanged) says which of `costs`,
`coordinates`, `photos` this trip keeps at all — exactly as today. This
phase adds two more questions the conversation checks, same shape:

- **weather** — asked whenever the day folder has coordinates (a location
  item, or phase 5's gps extraction) and the journal has the capability on;
  the three answers are declined, "look it up" (the existing `weather:
  true` + `npm run weather:update` path, unchanged), or a value the person
  states in words.
- **a caption per photograph** — asked once per image still missing one
  (`descriptionAsked` absent, `caption` absent); the two answers are
  declined (`descriptionAsked: true`, no caption) or the words they give.

`time`/`timezone`/`transport`/`translations` are **not** gating fields —
they are existing optional `Entry` fields the conversation may ask about
when relevant (translations: whenever the journal has more than one locale
and the day is about to be created, offer to draft the other language now
rather than leaving it owed; time/timezone: when more than one entry is
being written for the same date, or a reader's dual-clock would otherwise
silently assume the journal's own zone). None of them block "is this day
ready" the way `TRACKS` fields and weather do.

### Asking, once, in a batch

The point of staging in `day.json` rather than creating the entry
immediately: the agent surveys everything still missing for a date folder
and asks about it **together**, once — not one field per turn, the
back-and-forth the person is trying to get away from. A single turn can
carry "no photographs yet — anything to add? What did the day cost, if
anything? Should I look up the weather?" and the person's one reply can
answer all three, each parsed into its own `day.json` field.

**Never re-ask a field already answered.** A field with a real value, a
`without` entry, or an `unrecorded` entry is not asked again — the same
honesty-net principle AGENTS.md already states elsewhere ("a guard that
fires on an honest turn is a bug"), now applied to this batch of questions
too. This needs its own test: a folder with `without: ["costs"]` must never
produce a turn asking about costs again.

### Multiple days from one batch

Undated content with different dates implied (two photographs from
different days, two WhatsApp messages a week apart) is what triggers "one
day, or several?" as its own question, asked once per batch of newly-arrived
undated content. The answer assigns each item to its own date folder; each
folder reaches "ready" independently from there.

### Creating the day

Once nothing in `day.json` (plus the derived photos/words checks) is still
missing, the agent proposes creating the entry — still a `kind: "write"`,
`renders: "form"` proposal, nothing written until pressed, exactly
`start_day`'s existing shape. The press seeds the entry from `words.md`,
moves `media/`/`files/` into the real entry the way `attach_files` already
moves inbox photographs today, and writes `day.json`'s `without`/
`unrecorded`/`weatherAsked` straight onto the new entry's frontmatter. The
day folder is removed once this succeeds — its job was staging, and the
real entry is now where all of this lives, read the ordinary way from
then on.

## Phase 4 — a persistent statement store

Mirrors `gps/`'s own shape and the reasons it exists (a resource that
outlives any one day, imported once and read many times):

```
content/<user>/statements/
  <imported-file-id>.json    the parsed rows, dated, categorised —
                              the person's own reconciliation, kept
```

An imported statement's rows are written here once (the existing
`costs/import` reconciliation step, unchanged) *and* kept, rather than only
ever being written straight onto the days that existed at import time. A
day folder's `costs` field then reads as "extractable" whenever this store
has rows dated to it that have not yet been applied — the same "ask once,
use many times" shape `gps/`'s `track.json` derivation already has for
location.

This is the one genuinely new subsystem in the whole design and deserves its
own task, its own worktree, and its own review before it is built.

## Phase 5 — GPS as an extractable location source

`lib/gps/store.ts`'s `readRange(username, from, to)` already answers "what
fixes exist for this date range" — the whole of what phase 5 needs to know
whether a day folder's location is extractable from `gps/`. **The hard
constraint carries over unchanged: `gps/` is reachable from nothing under
`app/`, and an agent must never read it out.** This phase's own readiness
check may ask *whether* fixes exist (a boolean) and, once a person agrees to
use them, write the resulting coordinate into `day.json`'s `location` field
directly — but the raw fixes, or anything that looks like a trail, must
never appear in a proposal's text, a model's context, or a conversation log.
`test/gps-store.test.ts`'s existing import-graph assertion is the check that
would catch a violation of this.

## What this deliberately does not do

- **No change to what `publish` means or requires.** A day assembled this
  way still arrives as `status: draft`, still needs its own separate
  publish press.
- **No new consent surface for the browser's geolocation button** — the
  browser's own permission prompt is the whole of it.
- **The guest-invite behavior contact cards used to trigger automatically
  does not disappear** — it becomes a deliberate proposal instead of a
  side-effect (phase 1), tested as its own acceptance line.
- **Phase 4's statement store is not retroactive.** Statements already
  imported and applied under today's one-shot flow are not migrated in.
- **Translations stay required exactly as `checkTranslations` already
  requires them**, and are never machine-translated without being asked —
  phase 3 only adds "offer to do it now" to the existing rule, not a new
  policy about when a translation is owed.

## Open questions for the implementation plan, not for this spec

- The exact wording of each batched "ask" sentence — a locale/prose
  decision, not an architecture one.
- Whether a day folder that never reaches "ready" needs its own cleanup or
  surfacing in the history panel — likely yes, a `test-in-a-browser`
  question once phase 3 exists to look at.
- The precise shape of `contact`'s sidecar-parsed fields (name/phone/email
  only, or more of what a vCard can carry) — bounded by "nothing invented,
  only what the vCard states."
- Whether `weather` and photo-caption tracking eventually earn their own
  `TRACKS` rows (folding into the trip-wide `tracks:` declaration) rather
  than the bespoke pairs this spec keeps them as, matching
  `weatherAsked`'s existing precedent. Worth revisiting once phase 3 has
  shipped and it is clear whether a trip ever wants to turn either off
  entirely, the way it already can for costs/coordinates/photos.
