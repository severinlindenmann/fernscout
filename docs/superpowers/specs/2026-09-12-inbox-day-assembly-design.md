# Inbox day-assembly: everything lands in the inbox, a day gets proposed once nothing is missing

Written before the work, as intent — not updated to match what ships (per
`docs/README.md`'s own rule for `docs/plans/`; this is its cousin under
`docs/superpowers/specs/`, same convention).

## Motivation

Today, making a day is a sequence of separate, model-driven writes: a person
uploads photographs (into the flat, undated inbox), says "put these on
yesterday" (`attach_files`), then separately says what happened
(`draft_words`), and separately again is asked about weather or costs if at
all. Each of those is its own sentence, its own tool call, and the person is
carrying the structure of "what a day needs" in their head.

The wanted shape: everything the person has for a day — photographs, a
location pin, a shared contact, a voice note transcribed to text, a bank
statement — lands in one place regardless of when it arrives or in what
order, tagged to a date once that is known. Once nothing about that date is
still unanswered, the agent proposes the day itself, ready to press. The
person answers three kinds of questions at most per field, once: *here it
is*, *no, skip it*, or *look it up for me* — and only for the fields that
still need an answer.

## Scope and phasing

This is five independently shippable pieces. Each has its own acceptance and
can ship on its own; later phases depend on earlier ones existing, not on
each other's internals.

| Phase | What it adds | Depends on |
| --- | --- | --- |
| 1 | New inbox content: a browser "share my current location" button; WhatsApp location pins and shared contacts land in the inbox instead of their current auto-actions | Nothing new — extends `lib/inbox.ts` |
| 2 | `inbox/days/<date>/` — a per-date staging folder, and the "what's still missing" read that replaces `lib/helper/draft.ts` | Phase 1 (new kinds exist to file into it) |
| 3 | The conversation: survey a date folder, ask only what's missing, propose the day (or several) once nothing is | Phase 2 |
| 4 | A persistent statement store (mirrors `gps/`) so a bank statement imported once can answer costs for days written weeks later | Nothing new — parallel track, phase 3's costs field degrades gracefully without it |
| 5 | Wiring `gps/`'s existing history as the "extract" source for a day's location | Phase 2 (needs the day folder to write the result into) |

Phase 4 is the only wholly new subsystem; everything else extends what is
already on disk. Build in this order; a person can use phases 1–3 usefully
with costs staying declined/direct-only until phase 4 lands.

## Phase 1 — new inbox content

### Browser: "share my current location"

A button beside the composer, next to the attach-files control (paperclip).
Presses `navigator.geolocation.getCurrentPosition()` (the browser's own
permission prompt — no custom consent UI needed, the same as any site asking
for location). On success:

- Reverse-geocode the coordinate the same way `lib/whatsapp/dispatch.ts`'s
  `handleLocationPin` already does (`reversePlace`, gated on the
  `addressLookup` capability) — absent that capability, store the raw
  coordinate with no place name, exactly as WhatsApp already degrades today.
- Store it through `storeInboxFile` with a new `kind: "location"`. The bytes
  are a small JSON blob (`{ lat, lon }`); the sidecar's existing `lat`/`lon`
  meta fields (`InboxMeta`, already present) carry the coordinate a second
  time for anything that reads the sidecar without the bytes — the room's own
  file list never re-reads bytes for a thumbnail, so the sidecar needs to
  carry what it means to show.
- Undated by default, same as a photograph: it lands in the top-level inbox
  until it is tied to a date, either by the person (ticking it, saying "this
  is for yesterday" — same `attach_files`-shaped flow) or automatically by
  Phase 3 asking "is this for today?" the moment it arrives with nothing else
  pending.

### WhatsApp: location pins and contact cards, rerouted

`handleLocationPin` (`lib/whatsapp/dispatch.ts:628`) currently resolves the
message's date to a trip, and either edits an existing day's `lat`/`lng`
directly or creates one with `weather: true` set — immediately, no
selection step. Change it to instead call the same `storeInboxFile` path the
browser button uses, tagged `source: "whatsapp"` (the field `InboxMeta`
already carries) and dated to the message's own date up front (WhatsApp
already knows the date from the message timestamp, so this one *does* file
straight into `inbox/days/<date>/` rather than landing undated).

`handleContactCard` (`lib/whatsapp/dispatch.ts:732`) currently loops
`message.contacts` and creates a guest invite immediately for anyone with an
email. Change it to store each contact as `kind: "contact"` in the inbox
instead — the vCard's own bytes, with name/phone/email parsed at import time
into the sidecar (reading a vCard's own fields is not invention; nothing is
guessed). Undated, same as a photograph, unless the surrounding conversation
already named a date. **The existing "share a contact to invite them as a
guest" capability does not disappear** — it moves to being a deliberate
action a person takes on the stored contact (a new proposal, shaped like
`attach_files`: "invite Maria as a guest?"), rather than an automatic
side-effect of sharing the card at all. This is a real behavior change on a
shipped feature (B1074) and should be called out in its own task's Why
section when built, not buried in this phase's diff.

### `lib/inbox.ts` changes

- `INBOX_KINDS` grows two entries: `"location"`, `"contact"`.
- `INBOX_FILE_EXTENSIONS` already carries `.vcf` — a contact card needs no
  extension change, only the new `kind`.
- `kindForExtension` stays extension-driven for uploads through the picker; a
  location/contact item is never uploaded through the file picker (it always
  arrives through its own dedicated path — the browser button, or the
  WhatsApp handlers above) so `kindForExtension` never needs to guess either
  kind from a filename.
- `components/InboxFileGroups.tsx` gains a third visual group (today's
  `photos`/`documents` split) — `location` and `contact` items render with
  their own icon (a pin, a card) instead of the generic document icon a
  `.vcf` currently falls back to.

## Phase 2 — the day folder and derived readiness

### Data model

```
content/<user>/inbox/
  media/ files/                    unchanged: undated content
  days/
    <date>/                        one folder per date somebody has started
      media/ files/                same shape as the top-level inbox —
                                    tying an item to a date is moving its
                                    file + sidecar here, nothing more
      words.md                     accumulated prose — see below
      declined.json                the ONE new piece of persisted state
```

**`declined.json` is deliberately the only field that is ever written and
not re-derivable.** Everything else this phase reads is answered by listing
a directory or reading a file that is already there for its own reason —
the same principle `lib/helper/draft.ts`'s header comment states today
("there is no wizard-position field anywhere... the step is a function of
the draft"). This phase keeps that property rather than trading it away:

```json
{ "declined": ["weather", "costs"] }
```

A field name appears here once a person has been asked and said no. Absence
means "not asked yet, or answer still pending" — never "no."

### `words.md`

Plain markdown, no frontmatter fields beyond an `updatedAt` (so a stale
fragment can be told from a fresh one, the same reason B1059 stamps
`receivedAt` on a WhatsApp photograph). Every new sentence, transcription or
typed correction appends a paragraph; nothing here is ever overwritten
silently, because a person's own words are the one thing this project never
discards. When the day is created, this file's body becomes the entry's
initial `content:` — a further edit is exactly today's `draft_words`, just
seeded rather than starting from `NO_PROSE`.

### What replaces `lib/helper/draft.ts`

`WizardDraft`/`stepFor`/`backFrom`/`isWritten` describe a day that already
exists as a real entry, mid-way through being finished. That question does
not go away — a day with photographs and no words is still real once it is
created — but the *pre-creation* question ("is there enough here to propose
creating it at all") is new and belongs to the day folder, not to an entry
that does not exist yet.

Replace with one function, in the same file, keeping its name and shape
recognisable to `test/helper-routes.test.ts`'s existing callers:

```ts
type FieldState =
  | { state: "missing" }
  | { state: "declined" }
  | { state: "direct"; ... }     // the value itself, shape per field
  | { state: "extractable"; from: "gps" | "statement" };  // phase 4/5

type DayReadiness = {
  images: FieldState;   // derived: files in media/
  words: FieldState;    // derived: words.md has real content (isWritten, unchanged)
  location: FieldState; // derived: a location item in files/, or gps/ has fixes (phase 5)
  weather: FieldState;  // "extractable" always (the existing open-meteo lookup) unless declined
  costs: FieldState;    // declined/direct until phase 4; extractable once a statement covers the date
};

function readinessFor(username: string, date: string): DayReadiness;
function isReady(readiness: DayReadiness): boolean;  // every field missing → false
```

`isReady` is what `stepFor` was for the old machinery: the one predicate
everything else asks. A day route, WhatsApp dispatch, and the room all call
this rather than re-deriving it, for the same reason the old code did.

**Callers to update** (the blast radius `lib/helper/draft.ts`'s own doc
comment names): `app/api/helper/[user]/day/route.ts`,
`app/api/helper/[user]/day/publish/route.ts`, `app/TripStory.tsx`,
`lib/helper/tools/areas/days.ts`, `lib/whatsapp/dispatch.ts`. Each of these
reads `stepFor`/`isWritten` today for a real, already-existing draft entry;
none of them currently know about a day that has no entry yet at all, which
is what this phase adds underneath them.

## Phase 3 — the conversation

### The three answers, per field

Every field in `DayReadiness` above resolves to exactly one of:

- **declined** — the person said no. Written to `declined.json`, once.
- **direct** — the person supplied it themselves, in words or by attaching
  something (a typed weather description, a pinned location, a stated
  figure). Never invented by the agent — AGENTS.md's rule, unchanged, and the
  reason weather specifically still forbids the model supplying a value on
  its own even when asked directly.
- **extractable** — a lookup can answer it (weather's existing
  `open-meteo` route; gps/statement in phases 4–5). The agent's own
  proposal names the source ("look the weather up for you?", "your GPS
  history has a fix for that day — use it?") and nothing is written until
  the person agrees, the same `weather: true` + `npm run weather:update`
  shape that already exists.

### When the agent asks

Once a date folder holds *something* (any item filed to it, or the person
has said which date they mean) and at least one field is still `missing`,
the agent's next turn is allowed to ask about exactly the missing fields —
not all five every time, only what `readinessFor` still reports as missing.
Asking about a field already `declined` or `direct` is the exact honesty-net
class of bug AGENTS.md already guards against elsewhere ("a guard that fires
on an honest turn is a bug"); this needs the equivalent check here — a test
asserting the turn never re-asks a declined or already-answered field.

### Multiple days at once

Content in the top-level (undated) inbox with different dates implied — two
photographs from different days, two WhatsApp messages a week apart — is
what triggers "did you mean one day, or several?" as its own question,
asked once per batch of newly-arrived undated content rather than per item.
The person's answer assigns each item (or group) to its own date folder;
from there each date folder is independent and reaches "ready" on its own
schedule.

### Proposing the day

`isReady(readiness)` true is what makes `start_day` (already a
`kind: "write"`, `renders: "form"` tool — "nothing is created until they
press") propose creating the entry, seeded from the date folder's own
`words.md`, `media/`, and whatever `direct`/`extractable`-and-agreed values
exist. The press is unchanged: it writes the real entry and files move (or
are referenced) from the date folder into the entry the normal way
`attach_files` already moves inbox photographs onto a day today.

## Phase 4 — a persistent statement store

Mirrors `gps/`'s own shape and the reasons it exists (a resource that
outlives any one day, imported once and read many times):

```
content/<user>/statements/
  <imported-file-id>.json    the parsed rows, dated, categorised —
                              the person's own reconciliation, kept
  exclude.json                (if ever needed) rows a person said don't
                               belong to this journal at all
```

An imported statement's rows are written here once (the existing
`costs/import` reconciliation step, unchanged) *and* kept, rather than only
ever being written straight onto the days that existed at import time. A
day's `costs` field then reads `"extractable"` whenever this store has rows
dated to it that have not yet been applied — the same "ask once, use many
times" shape `gps/`'s `track.json` derivation already has for location.

This is the one genuinely new subsystem in the whole design and deserves its
own task, its own worktree, and its own review before it is built — flagged
here so its size is not discovered mid-implementation of everything else.

## Phase 5 — GPS as an extractable location source

`lib/gps/store.ts`'s `readRange(username, from, to)` already answers "what
fixes exist for this date range" — the whole of what phase 5 needs to know
whether a day's location is `"extractable"` from `gps/`. **The hard
constraint carries over unchanged: `gps/` is reachable from nothing under
`app/`, and an agent must never read it out.** So this phase's own
`readinessFor` call may check *whether* fixes exist (a boolean) and, once a
person agrees to use them, write the resulting coordinate onto the day
directly — but the raw fixes, or anything that looks like a trail, must
never appear in a proposal's text, a model's context, or a conversation log.
`test/gps-store.test.ts`'s existing import-graph assertion is what would
catch a violation of this if `readinessFor` ever imported `lib/gps/store.ts`
from a file that assertion does not already permit — reading that test
before writing the phase 5 code is the check, not a new one.

## What this deliberately does not do

- **No change to what `publish` means or requires.** A day assembled this
  way still arrives as `status: draft`, still needs its own separate
  publish press, exactly as `POST .../publish` already requires.
- **No new consent surface for the browser's geolocation button.** The
  browser's own permission prompt is the consent; nothing here adds a second
  one, the same way an upload's own file picker needs no extra "are you
  sure."
- **The guest-invite behavior contact cards used to trigger automatically
  does not disappear** — it becomes a deliberate proposal instead of a
  side-effect, as phase 1 says, and should be tested as its own acceptance
  line rather than assumed unchanged.
- **Phase 4's statement store is not retroactive.** Statements already
  imported and applied under today's one-shot flow are not migrated into
  the new store; only statements imported after phase 4 ships populate it.

## Open questions for the implementation plan, not for this spec

- The exact wording of each "ask" sentence per field (weather, location,
  costs) — a locale/prose decision, not an architecture one.
- Whether a date folder that never reaches "ready" (abandoned mid-gathering)
  needs its own cleanup or surfacing in the history panel — likely yes, a
  `test-in-a-browser` question once phase 3 exists to look at.
- The precise shape of `contact`'s sidecar-parsed fields (name/phone/email
  only, or more of what a vCard can carry) — an implementation detail of
  phase 1, bounded by "nothing invented, only what the vCard states."
