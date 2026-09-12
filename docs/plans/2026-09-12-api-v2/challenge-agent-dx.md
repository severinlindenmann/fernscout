# Challenge: Fernscout v2 from the agent's seat

Adversarial review of the required-or-declined pattern (`lib/api/v2/schemas/shared.ts`,
`day.ts`, `trip.ts`, `journal.ts`, `media.ts`) against emerging agent-facing API
practice (structured, example-carrying errors; "right on the first try" as the
Agent-Experience bar; self-describing tool responses — MCPify, Speakeasy MCP
tool-design guidance, apideck's agentic-era API principles, 2026).

## Walked scenario (used to ground every finding below)

Agent creates a journal, one trip, three days with two photos each, publishes
each day. Field counts from the actual schemas: journal = 2 declinables, trip
= 10 declinables + conditional `teaser`/`listed` + a `buddies` cross-check
(≈12-13 live questions on a closed solo trip), day = 14 declinables, photo
upload = 3 declinables (`trip`, `day`, `caption`).

Round trips for a *competent* agent that has already fetched `/openapi.json`
once and learns the pattern after its first failure per resource type:

| Step | Calls |
|---|---|
| Discovery (status/openapi) | 1 |
| Journal create (fails 422 once, retry) | 2 |
| Trip create (fails 422 once — 11-13 missing — retry) | 2 |
| 3× day photo pairs, uploaded before the day exists → inbox (`day` declined) | 6 |
| 3× day create (day 1 fails once, days 2-3 pattern-match) | 4 |
| 3× publish | 3 |
| PATCH trip to set `cover` once photos exist (declined at creation — see §3) | 1 |
| **Total** | **19** |

A weaker model that also fumbles `visibility` vocabulary or a day field once
per day realistically lands at 24-27. A v1-shaped, mostly-optional API doing
the same walk is ~8-10 calls. This is the number every finding below is
arguing about.

---

## Ranked findings

**1. The pattern guarantees a 422 on the first call to every non-trivial
resource — "first try" cannot exist for trip or day create.**
Scenario: an agent that sends a genuinely complete, correct trip document —
right types, right enums, nothing missing by carelessness — still gets a 422
if it did not also either answer or explicitly decline all ~11 declinable
sections, because there is no "I have nothing to add, leave these at their
defaults" shortcut; every section is a decision. Cost: the round-trip table
above shows this tax paid twice (journal, trip) minimum and up to four times
(day 1) in one short session, each 422 costing several hundred tokens of
missing-list body. Benefit: none on the first call specifically — the value
of the 422-as-documentation only exists for the *second* call. Recommendation:
accept that trip/day create will never satisfy the "right on the first try"
AX bar the industry is converging on, but make that price visibly worth it
(see #2) rather than uniform across all fields.

**2. Relax the rule for cosmetic fields; keep it for safety-critical ones —
this is the concrete place to narrow the declinable list.**
Not every one of a day's 14 or a trip's 10 declinables carries the same
stakes. `weather`, `visibility`, `status`, `timezone` gate an actual AGENTS.md
safety rule (no invented readings, no guessed privacy, publish stays a second
call) — forcing a conscious answer there is the pattern doing its job.
`tags`, `accent`, `tagline`, `translations` (on a single-locale journal it is
already skipped — good precedent) gate nothing dangerous; an absent tag list
or an unset accent is the "overwhelming default" rule 2 already carves an
exception for, and the schema does not use it here. Recommendation: move
`tags`, `accent`, `tagline` (trip) and `tags` (day) to plain `.optional()`,
same treatment `travelScene`/`transportFrom` already get on `day.ts`. This
alone cuts the day's declinable set from 14 to ~11 and the trip's from 10 to
~7 — meaningfully fewer 422 rows and fewer decline-fatigue prompts (see #6)
without touching a single safety-shaped field.

**3. `cover` is not a real question at trip-creation time — it is a forced
decline every time, which makes it a fake declinable.**
Scenario: an agent creating a trip before any photo exists (the only order
the schemas allow — `mediaIntent.trip` needs a trip id, so photos cannot
predate the trip) cannot supply `cover` (a media `src`) because no `src`
exists yet. It must decline, always, on every trip that starts with zero
photos — which given the media door's own trip-must-exist-first constraint is
every trip. A declinable whose "why required" the caller can never honestly
answer with real content is padding, not a decision. Recommendation: drop
`cover` from `TRIP_DECLINABLES` for create specifically (keep it
required-or-declined on *update*, once photos can exist) — auto-pick newest
photo is already the documented decline behaviour, so make it the create-time
default outright and let an agent set it explicitly later with a plain PATCH.

**4. Trip create can embed a `days` array, but a single bad day fails the
whole trip — this is a footgun the design does not warn about.**
`tripCreate.days` accepts `dayWrite[]`, and each embedded day is checked by
the *same* 14-field required-or-declined refiner (day.ts's check runs
per-element via `dayWrite`). One missing field on day 3 of 3 means the
journal, the trip's title, dates, people, rates, costs, plan — everything —
is rejected too, because `strictObject` validation is all-or-nothing. An
agent that reasonably tries to "create the trip with its first three days in
one call" to save round trips gets punished harder than one that never tried:
a 422 whose missing-list now spans trip-level *and* day-level fields at once,
with no indication which day owns which row (the `path` on each issue is
`[field]` for trip-level checks but the day-array's own `superRefine` inside
`dayWrite` produces paths relative to the day, not indexed into the array —
worth confirming this renders as `days.2.weather` and not just `weather`
before shipping). Recommendation: document embedding `days` at create as an
anti-pattern for anything beyond a single already-complete day, or split
validation so a per-day failure returns which array index failed without
discarding the trip-level fields already known good.

**5. Full-document echo has no ceiling, and a day's shape is not small.**
`tripDoc.days` echoes every day as a complete `dayDoc` — media items (each
with `url`), full `weatherData`, `translations` per locale, `costs` arrays —
on every trip GET and every trip write's echo. A 90-day trip with photos on
most days and a two-locale journal is plausibly hundreds of KB of JSON for a
single `GET /api/v2/{user}/trips/{trip}` call an agent makes just to check
whether day 47 has a `cover` set yet. No pagination, no field-selection, no
summary variant is mentioned anywhere in trip.ts. Cost: an agent working late
in a long trip pays full-trip-body tokens for a one-field question, repeatedly,
because rule 5 ("one fact, one address") correctly forbids a *second* place
to read `cover` from but says nothing about reading it *cheaply*.
Recommendation: a `GET .../trips/{trip}?days=false` (or a separate
`GET .../trips/{trip}/days` list of `{slug, status, title}` only) — not a
second address for the same fact, a narrower view of the one address, which
rule 5 does not forbid.

**6. Decline-fatigue is real and the ≥10-character floor does not stop it.**
`declineReason` rejects `"n/a"` but accepts `"not applicable here"` (20 chars,
zero information) or, worse, the same templated sentence copy-pasted across
all three days' `tags`, `translations` and `costs` declines. A model under
token pressure after the second or third 422 in a row will learn to pad
rather than think, because padding is cheaper than reconsidering the field —
and the schema cannot distinguish a padded decline from a considered one; it
can only count characters. This is the predictable failure mode of a
length-only quality gate. Recommendation: keep the floor (it genuinely stops
`false`/`"unknown"`/`"n/a"`, v1's actual failure mode per day.ts's own
comment) but do not present it as a quality control — it is a spam filter,
not a diligence proof. Pair it with #2's cut so there are fewer chances to
pad in the first place; that does more for reason quality than a stricter
regex would.

**7. PATCH semantics for `day` are undefined in the schemas read — a likely
dead-end for "attach a photo to an existing day."**
`day.ts` exports `dayWrite` and `dayDoc` but no `dayPatch`. `trip.ts` shows
the pattern for merge-patch elsewhere (`journalPatch = base.partial()`) but
nothing equivalent exists for a day. If updating a day (e.g. attaching a
`src` uploaded after the day was created, exactly the flow the media door's
own `day` decline recommends — "without one it lands in the inbox to be
attached later") reuses `dayWrite` wholesale rather than a partial variant,
then attaching one photo later requires re-declaring or re-declining all 14
day fields again — full ceremony, for a one-field change, defeating "JSON
Merge Patch" as rule 1 promises. This is the one place in the walked scenario
that risks becoming a genuine dead-end rather than merely expensive.
Recommendation: confirm (open question for the owner) that day update is
merge-patch with the required-or-declined check skipped for fields not
present in the patch body — mirroring `journalPatch` — and add `dayPatch` to
day.ts explicitly rather than leaving it implicit.

**8. Two status doors, one differing by a path segment, is a real
misdial risk for a weak model.**
`GET /api/v2/status` (instance facts) and `GET /api/v2/{user}/status`
(journal standing — drafts, trips, capabilities) are correctly separated per
rule 5, but nothing in the schemas read gives either response a pointer to
the other, and the names differ only by the presence of `{user}`. An agent
that guesses the instance-facts shape when it wanted its own drafts list (or
vice versa) gets a valid 200 with plausible-looking but wrong-scope JSON, not
an error — the worst failure mode, because nothing tells it to retry.
Recommendation: each status response names the other explicitly
(`{"seeAlso": "/api/v2/status"}` on the journal one and vice versa) — cheap,
and turns a silent misdial into a one-hop correction.

**9. The 422 body itself is a genuine best-practice match — worth
protecting, not just critiquing.** `incompleteDetails` (why_required +
`to_provide` schema excerpt + `to_decline` string, per missing field) is
close to exactly what the current MCP/agent-tool-design literature asks for:
concrete example in the error, not just a code; state what's wrong and what
the correct form looks like. This is the strongest part of the design and the
reason #1's guaranteed-422 cost is survivable rather than fatal — a weak
model with zero prior exposure to this API can, in principle, construct a
fully correct day purely from two 422 bodies (first for missing top-level
fields, second for a malformed `weatherData`) with no external docs at all.
Keep this; do not simplify it to save response bytes.

**10. `whyRequired` text carries shape, not always the trap.**
Compare `weather`'s decline text ("brings a real reading, or declines" —
correctly nudges toward the open-meteo/never-invent rule) against `visibility`
on `day.ts` ("or declined — declined means shown to everyone the trip lets
in" — this one is good) versus the *trip's* top-level `visibility` field,
which is `required` with no declinable text at all beyond the type
comment ("An explicit choice, never a guessed default") and never states the
guest-vs-private trap AGENTS.md spends a full paragraph on ("`guest` means
the people I let into this journal; `private` means only the people who were
there"). A model that has read the schema but not AGENTS.md will pick a
syntactically valid, semantically wrong value with no error to catch it —
schema validation cannot check meaning, only shape. Recommendation: fold the
one-sentence version of that trap into the field's own doc comment (which the
generated docs presumably surface), the same way `weather`'s decline text
already encodes its own rule.

**11. The walked flow does not dead-end on a browser-only page — confirmed,
worth stating positively.** Nothing in journal/trip/day/media create-and-
publish requires a page only a cookie session can render (`/me`, `/contacts`,
postcard send, delete). The core content loop is fully agent-completable end
to end, which is not true of every area of v2 (postcards, deletion, credits
purchase are correctly and deliberately agent-incomplete per rule 9). Good;
no action needed, but call it out explicitly in the final design doc so a
reviewer does not have to re-derive it.

**12. Media's `day` decline forces a two-step attach for any photo taken on a
day that does not exist yet at upload time.** Scenario: an agent processing a
batch of photos chronologically, before it has decided day boundaries, must
decline `day` on each upload (→ inbox), then later reference those `src`s
from each day's `media` array. That is the *documented* intended path
(comment: "without one it lands in the inbox to be attached later") and is
reasonable — but it means the "3 days × 2 photos" scenario above pays 6 media
round trips plus, per #7, a possibly-full-ceremony PATCH per day to attach
them if days were created before the photos. Recommendation: none beyond
noting the true round-trip count includes this; it is inherent to the
content model (photos may predate day boundaries) rather than a design flaw.

**13. No retry/category hint on the error envelope.** `errorEnvelope` is
`{error, message, details?}` with no `retryable` or category
(validation vs transient vs permission) field. Every code in
`lib/api/errorCodes.ts` is presumably deterministic-on-retry-without-change
(422s stay 422 until the body changes; `already_published` stays 409
forever), so an agent can usually infer retryability from the code alone —
but a generic client library written once for the whole v2 surface cannot,
without hardcoding the same per-code table the server already has.
Recommendation: low priority; a static `RETRYABLE: Record<ErrorCode,
boolean>` exported beside `errorCodes.ts` would let a thin client retry
`no_credits`-after-purchase-style codes without a bespoke switch, but the
existing shape does not block an agent — it only makes a *generic* client
marginally dumber.

**14. Decline text as documentation stops at the JSON boundary — the
publish `notify` nudge is prose-only, correctly, but that has a real
conversation-turn cost the round-trip count above does not capture.** Rule 9
requires "ask, in words, and wait for an answer" rather than a machine flag;
`publish`'s `notify.ask` response field exists to prompt exactly that. Good —
this is the safety shape working as intended, not a flaw — but it means the
walked scenario's true cost to the *person* is 19+ API calls plus at least
one held conversational turn per day publish where the agent must stop and
ask a human, not just call an endpoint. Worth stating explicitly in the
owner-facing summary so "19 round trips" is not mistaken for "19 seconds": a
few of those steps are gated on a human answering, not on network latency.

**15. Decline reasons compound with the media door's own declinable set —
the walked scenario has ~55-70 individual required-or-declined judgement
calls across one trip's worth of content (10 trip + 3×14 day + 3×2×3 media +
2 journal ≈ 66).** Even with #2's cut this stays in the 40s. No single one of
these is unreasonable in isolation — each maps to a real AGENTS.md rule or a
real missing-data honesty requirement — but the aggregate is the actual
tax an owner is paying for "no invented content, ever," and it should be
sized once, explicitly, in the design doc the owner reads, rather than
discovered piecemeal the first time a real agent tries to onboard a real
90-day trip.

---

## Summary for the owner

The pattern is *not* wrong — for the fields that gate an actual safety rule
(weather provenance, visibility, publish-is-a-second-call), forcing a
conscious answer is the whole point, and the 422 body is genuinely good
agent-facing documentation, better than most of what the current best-practice
literature asks for. The problem is that the same ceremony is applied
uniformly to fields with nothing at stake (tags, accent, tagline), which
multiplies round trips and invites padded declines without buying any of the
safety the pattern exists for. Relax rule 2 selectively (#2), fix the one
real forced-fake-decline (`cover`, #3), and confirm day PATCH is genuinely
partial (#7) before shipping; the rest are sizing and discoverability notes,
not blockers.
