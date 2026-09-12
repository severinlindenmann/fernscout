# Fernscout v2 — adversarial challenge: HTTP/REST practice

Scope: `lib/api/v2/schemas/*.ts` (decided core) + `BRIEF.md` + the six area
designs. Ranked most-important-first. Each finding: what practice says,
what v2 does, verdict, recommendation.

---

## 1. PATCH is mandated by rule 1 but undesigned for the two resources that need it most

**Practice.** RFC 5789 (PATCH) plus RFC 7396 (JSON Merge Patch): a partial
update needs its own documented schema — which fields a PATCH body may
carry, and what `null` means. Google AIP-134 makes the same point from a
different angle: validation is contextual — full/required on create, but on
update only fields present (or in the mask) are checked; the update request
"must not contain other required fields."

**What v2 does.** `journal.ts` gets this right: `journalPatch = base.partial()`
exists, exported, distinct from `journalWrite`. `trip.ts` and `day.ts` do
not — there is no `tripPatch` / `dayPatch` anywhere in the decided core
(`index.ts` exports only `tripCreate`/`tripDoc` and `dayWrite`/`dayDoc`), and
no area doc defines one either (grepped for `PATCH.*trips/{trip}` and
`dayPatch` across all six area files: zero hits). Yet BRIEF rule 1 states
"written whole (or JSON Merge Patch)" as non-negotiable, and rule 9 lists
`EditDay` as an existing correction path a person uses on a day that "already
carries" fields. `checkRequiredOrDeclined` is wired only into `tripCreate`'s
`superRefine`, and it runs the *whole* declinable ledger unconditionally —
applied to a merge-patch body as-is, it would demand `rates`, `plan`,
`figures` etc. be re-supplied or re-declined on every one-field edit, which
cannot be what's intended.

**Verdict: gap (not yet a violation — the schemas are phase 0 — but a load-
bearing one).** The single most consequential mechanic the whole redesign
promises (whole-document write, or merge-patch) has no partial-shape and no
partial-validation story for the two busiest resources.

**Recommendation.** Define `tripPatch`/`dayPatch` as `.partial()` variants
before any route ships, and decide explicitly whether `checkRequiredOrDeclined`
runs against the *merged* document (server fetches current + applies patch,
then validates the union) or is skipped on PATCH entirely. The former is
correct per AIP-134's spirit and per rule 2's own stated purpose (no field
silently missing) — validate the merge result, not the diff.

---

## 2. No optimistic concurrency anywhere, on a resource three different writers touch

**Practice.** RFC 7232 (ETag / If-Match / If-None-Match) is the standard
answer to lost updates on PUT/PATCH; Zalando's guidelines and most mature
REST APIs require `ETag` + `If-Match` on any resource with concurrent
writers. AIP-134 achieves the same with `etag` as a resource field.

**What v2 does.** Zero mentions of `ETag`, `If-Match`, `version`, `revision`
or "optimistic" anywhere in the six area docs or the decided core (checked
by grep). A trip/day in this product is written by up to three independent
actors with no coordination between them: an agent over `/api/v2` (this
document), the owner correcting a published day through `EditDay` (`/api/web`,
per AGENTS.md), and a buddy's trip-scoped token. `web.md` §3.2 even names the
symptom directly — the wizard's `day/undo` exists "only because the wizard
has no version history and `PATCH` overwrites in place" — and proposes
keeping `undo` as a bandage rather than fixing the underlying lost-update
exposure. Two writers on the same trip within the same minute (a documented,
non-hypothetical scenario for this product — a buddy on the trip and the
agent both editing) will silently clobber one another with the second write
winning outright.

**Verdict: violation.** This is exactly the gap ETag/If-Match exists to
close, on a resource explicitly designed for multiple concurrent writers.

**Recommendation.** Add a server-owned `etag` (or `updatedAt`, weaker but
cheaper) to `tripDoc`/`dayDoc`, require `If-Match` on PATCH, answer `412
Precondition Failed` on mismatch. At minimum, document the lost-update
exposure as an accepted risk if the owner chooses not to build it — right
now it's neither designed nor acknowledged as a decision.

---

## 3. Unbounded, unpaginated lists inside "read whole" resources

**Practice.** Zalando: prefer pagination on every list resource, cursor-based
over offset; Google AIP-158 (list pagination) is a standard method
requirement. Returning an unbounded array in a single-document read is a
known scaling trap once a collection has no natural ceiling.

**What v2 does.** `tripDoc.days` is `z.array(dayDoc)` — the *full* body,
media, costs, translations of every day on the trip, every time any part of
the trip is read. `journalStatus.trips` and `journalStatus.drafts` are
likewise flat unbounded arrays. Only one list in the whole construct designs
pagination at all: `money.md`'s credit ledger (`?before=<id>&limit=`), and
even that punts — "the exact cursor field name is the core schema's call once
list-pagination is settled there" (money.md:425) — but list-pagination is
never settled anywhere in the core. A multi-year "current" trip (the kind
this redesign explicitly supports by deriving `status` from dates rather than
storing it) or a long-running journal's status call has no stated ceiling.

**Verdict: mixed — partly a defensible deviation, partly a real gap.**
Embedding days in the trip document is defensible: rule 1's "few doors, read
whole" is a genuine product fit for a *personal* travel journal where trips
run to tens of days, not thousands, and per-day sub-fetches would be an N+1
tax the client always pays. But "no stated ceiling, and the one place
pagination was sketched explicitly defers the decision to a place that never
makes it" is a gap, not a decision.

**Recommendation.** Pick and record a ceiling (e.g. "trips read whole up to
N days; past that, `days` becomes a summary array + a separate paginated
`days` endpoint") — or explicitly decide "no journal will ever have enough
days for this to matter" and say why, in the ledger. Either is fine; silence
isn't.

---

## 4. The 422 "required-or-declined" pattern inverts HTTP's optionality convention — deliberately, and it is the right call, but the combination with strict-object rejection is a real trap

**Practice.** HTTP/JSON-Schema convention: an absent optional field is
silence, not an error. Most APIs (Google AIP-203, OpenAPI `required`) reserve
422/400 for malformed or genuinely-missing-required data, and treat "I have
nothing to say about X" as the *default* meaning of omission.

**What v2 does.** Every declinable field must be present or named in
`declined` with ≥10 characters of reasoning, refused as a **conflict** if
both, refused as **missing** if neither. This is stated as core rule 2 and
is clearly a deliberate, well-reasoned departure — the whole point is to
force an agent to say "no coordinates because none were mentioned" instead
of silently omitting a field a later reader can't distinguish from "wasn't
asked." That's a defensible deviation from REST convention, argued well in
BRIEF and consistent throughout.

**Where it goes further than the stated goal, though:** `dayWrite` and
`tripCreate` are `z.strictObject`, so a caller that sends `costs: []` *and*
also happens to include an inherited/stale `declined.costs` key from a
previous document round-trip gets a **hard conflict refusal**, not a
"declined is now moot, cleared automatically" resolution — this is exactly
the retraction problem B1564 already found in v1 ("attach_files leaves
`photos` in `unrecorded`/`without`... an edit that supplies what was declined
clears the decline"), and the ticket scan itself flagged it as "absorb into
v2 now" (tickets.md, B1564). The shared `checkRequiredOrDeclined` in
`shared.ts` still treats brought+declined as a symmetric conflict, not as
"brought wins, decline is stale and silently cleared" — the fix B1564 asked
for hasn't landed in the decided core.

**Verdict: defensible deviation (the pattern itself) with one unresolved
violation inside it (retraction).**

**Recommendation.** `checkRequiredOrDeclined` should let a present field
silently override a stale `declined` entry for the *same* field in a PATCH
context (server drops the stale key rather than erroring) — reserve the hard
conflict for a single write that names both in the same payload.

---

## 5. Error envelope reinvents Problem Details instead of adopting it

**Practice.** RFC 9457 (Problem Details for HTTP APIs, obsoleting RFC 7807)
is the closest thing REST has to a standardised error envelope: `type`,
`title`, `status`, `detail`, `instance`, `application/problem+json`. Zalando
and Google both converge on something in this family.

**What v2 does.** `errorEnvelope` is `{error, message, details?}` — a
perfectly reasonable custom shape, but it is not `application/problem+json`,
carries no `status` field inside the body (status lives only in the HTTP
status line), and `error` values come from a private `ERROR_CODES` map rather
than a `type` URI. This is fine as an internal convention (rule 7 states it
as one envelope, consistently applied, which is the thing that actually
matters for an agent parsing responses) — but it forfeits interoperability
with generic HTTP tooling that already understands `problem+json`
(browsers' dev tools, some OpenAPI codegens, API gateways) for no stated
reason.

**Verdict: defensible deviation, worth a one-line justification in the
ledger** ("we want one flat vocabulary keyed to `lib/api/errorCodes.ts`, not
URIs") rather than silent divergence — a reviewer unfamiliar with the
decision will otherwise flag this as an oversight, as this review nearly did.

---

## 6. PUT vs POST for client-chosen-id create is applied inconsistently across areas

**Practice.** Zalando: POST for server-assigned ids; **PUT** when "the
identifier and all resource attributes are under control of the client" —
PUT's idempotency is exactly the property client-chosen-id create wants.

**What v2 does.** Two different area docs solve the *identical* problem
(client-chosen id, retried create → 409/200-with-existing) with two
different verbs. `print.md` uses real `PUT /api/v2/{user}/postcards/orders/{id}`
(correct, idiomatic). `money.md` explicitly says the opposite — "asks the
caller for one, `PUT`-shaped semantics **on POST** (create-if-absent)"
(money.md:82) — i.e. `POST` to a collection URL carrying a client-chosen id
in the body, mimicking PUT's idempotency without PUT's verb or URL shape.
The decided core's own `tripCreate`/`dayWrite` (`trip.ts`, `day.ts`) don't
state a verb at all — that's left to the area docs, which never resolves it
either (content.md nowhere pins `POST` vs `PUT` for trip/day create).

**Verdict: violation — not of "PUT vs POST" per se (reasonable people pick
either), but of BRIEF rule 12's own logic** ("a second list beside the first
is a list that will disagree with itself") applied one level up: two areas
independently solved the same client-chosen-id-create problem and reached
different verbs, with no core decision pinning either. An agent building a
client from the OpenAPI doc will see `PUT .../postcards/orders/{id}` next to
(presumably) `POST .../trips` and have no way to know these are the same
pattern.

**Recommendation.** Pick one (PUT is the more standard choice here, and
matches what `print.md` already does) and apply it to every client-chosen-id
create — trip, day, purchase, postcard order alike — in the core schemas
document, not per-area.

---

## 7. `202` for delete and `402` for no-credits are correctly applied, not deviations worth flagging

**Practice.** RFC 9110 §15.3.3: 202 Accepted is precisely "the request has
been accepted for processing, but the processing has not been completed" —
textbook-correct for the mail-then-button delete flow (rule 9, untouchable).
402 Payment Required has no IANA-registered semantics beyond reservation, but
its informal reuse for "this would need money you don't have" is widespread
(shown in this construct at `no_credits` in `content.md`/`money.md`) and
unambiguous in context.

**Verdict: not a finding.** Included here only because the review brief
asked these be looked at hard — both hold up. The one adjacent gap: 409 on
retried-create is used correctly per resource (`tripCreate`, purchases,
postcard orders) but its body contract — "with the stored document" per rule
6 — is stated in BRIEF and in money.md, not verified as symmetric across
every create route in the area docs. Worth a contract test once routes
exist, not a design finding.

---

## 8. Content negotiation is done by URL suffix, not `Accept`, without comment

**Practice.** HTTP content negotiation (`Accept: text/markdown` vs
`application/json`) is the RFC 9110-native way to serve the same resource in
two representations. Convention varies — GitHub's API uses `Accept`, GitHub's
web UI uses `.md`-suffixed raw URLs — so this is not clear-cut either way.

**What v2 does.** `GET /{user}/day/{slug}.md` and
`GET /{user}/trips/{trip}/day/{slug}.md` are explicitly **outside**
`/api/v2` — "a page-shaped URL with `.md` appended" (content.md §8) — kept
apart from the JSON contract entirely rather than content-negotiated on the
same resource URL.

**Verdict: defensible deviation, and arguably the better call here.** These
markdown twins are consumed by humans pasting a URL and by crawlers, not by
an agent driving the bearer contract — collapsing them into `Accept`
negotiation on the same URL would complicate caching (a CDN keying on path
is simpler than one keying on `Vary: Accept`) for no benefit to this
product's actual callers. No recommendation; noted because the brief asked.

---

## 9. Read/write field duplication via `{...dayWrite.def.shape, ...}` is the exact anti-pattern rule 12 exists to prevent, one level up

**Practice.** OpenAPI's native `readOnly`/`writeOnly` keywords exist
precisely so one schema serves both request and response validation with a
single source of truth on which fields are server-owned. Google AIP-203
achieves the same with `OUTPUT_ONLY` field annotations on one message type.

**What v2 does.** `dayDoc` and `tripDoc` are built by hand-spreading the write
schema's shape object and re-declaring the fields that differ
(`z.object({...dayWrite.def.shape, status: ..., media: ..., weather: ...})`
in `day.ts`; the analogous pattern in `trip.ts`). This is workable today with
two files and three overridden fields, but it is structurally the same
"hand-kept list that mirrors another hand-kept list" shape the ticket scan
flags four separate times as the disease v2 exists to cure (tickets.md §3:
B1577's `doors`, B1525's drifted PATCH field list, B1584/B1586's three
independent field lists, B1028's split owner/agent field lists) — the
difference here is it's *inside* the decided core itself, not a v1 legacy
routine.

**Verdict: gap.** Not wrong today, but it is the one place in the "decided"
schemas where a future field addition can silently update the write shape
and forget the read shape (or vice versa), and nothing catches it — no test
was found asserting `dayDoc`'s shape is exactly `dayWrite`'s plus a named
override set.

**Recommendation.** Either a small helper (`readShape(writeSchema, {overrides})`
that asserts every override key exists in the write shape, so a typo or a
forgotten field fails at import time) or a `test/v2-schema-shape.test.ts`
asserting the same by diffing `Object.keys`. Cheap insurance against the
exact bug class four open tickets already describe.

---

## 10. `/api/v2` conflates API *version* with *audience*, which will need resolving the day `/api/web` needs a breaking change

**Practice.** API gateway convention typically keeps versioning and audience
(internal vs external, browser vs machine) as orthogonal axes — e.g.
`/api/{audience}/{version}/...` — precisely so either can evolve without
forcing the other to.

**What v2 does.** Rule 13's four prefixes — `/api/v2` (bearer), `/api/web`
(cookie), `/api/auth`, `/api/webhooks` — put the version number only on the
agent-facing contract. This is a reasonable, deliberate choice given the
product's actual constraint (decision 24: only the bearer contract is a
published, external, versioned promise; `/api/web` is explicitly "outside the
published contract" and free to change under its callers, which are this
codebase's own pages). Noted as **defensible**, not a violation.

**The one real gap:** nothing in BRIEF or the area docs says what happens
when `/api/web` itself needs a breaking change that its own pages can't
absorb in one deploy (a real scenario once a mobile app or a third-party
owner-dashboard exists reading `/api/web`, which several area docs already
gesture at as "not versioned because internal-only" without saying "and this
is why that's safe forever"). Not urgent, but worth one sentence in BRIEF
rather than silent assumption.

---

## Summary — top 5

1. `tripPatch`/`dayPatch` are mandated by rule 1 but do not exist anywhere in the decided core or the area docs — the redesign's central write mechanism is undefined for its two busiest resources.
2. No ETag/If-Match/version field anywhere, on a resource three independent writer classes (agent, owner's `EditDay`, buddy token) touch concurrently — v1's `day/undo` bandage is carried into v2 unexamined instead of fixed at the root.
3. `tripDoc.days` and `journalStatus.trips`/`drafts` are unbounded, unpaginated arrays; the one place pagination is sketched (money.md's ledger) explicitly defers the shape to "the core schema," which never settles it.
4. The required-or-declined pattern is a well-argued, defensible deviation from REST's optionality convention — but its retraction case (present field + stale `declined` entry) still treats override as conflict, the exact bug B1564 already found and tickets.md flagged for absorption.
5. Client-chosen-id create is PUT in `print.md` and "PUT-shaped POST" in `money.md` for the identical pattern, with the core schemas never pinning either — the same drift-between-hand-kept-lists disease this redesign exists to cure, one level up.
