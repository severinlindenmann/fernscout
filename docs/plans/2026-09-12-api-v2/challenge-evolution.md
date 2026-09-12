# Challenge: v2 evolution, versioning and migration risk

Adversarial review of the "no v3, additive-only" posture, the five-phase
migration order (schemas → parallel v2 → helper rewired → webapp → v1
sunset — `tickets.md` line 52), and the one-serializer promise, against
industry practice (RFC 8594 Sunset, RFC 9745 Deprecation, strangler-fig
parallel-run, consumer-driven contracts) and the code actually read at
`lib/api/v2/schemas/*.ts` and the design docs in this directory.

Ranked, most dangerous first. 10 findings.

---

## 1. `strictObject` + "asked-or-declined" makes every new declinable section a breaking change — and there is no advisory phase to absorb it

**Risk:** The core design rule (BRIEF.md rule 8, "kill inert fields", and
rule 2, "silent omission → 422") is enforced with `z.strictObject` end to
end (`trip.ts`, `day.ts`, `journal.ts`, `figures.ts`, `media.ts`,
`status.ts`, `shared.ts` — every top-level document schema). `strictObject`
throws on **unknown** keys on write, and `checkRequiredOrDeclined`
(`shared.ts`) 422s on **missing** required/declinable keys that are neither
present nor named in `declined`. Combine the two: the day this project adds
a new declinable section to `dayWrite` (a `tags` field, say, with a
`whyRequired`), *every existing client's next write 422s* until it starts
sending either the field or a `declined` entry for it — a policy change
inside "v2", with no version bump, breaking every BYO agent that has not
been told. The industry answer to exactly this shape of problem is a
tolerant-reader default (Postel's law / Zod's own `looseObject`/
`passthrough` guidance for config forward-compatibility — see the
`opencode` discussion cited in research above) or an explicit minor-version
signal; this design has neither. It calls the new-field problem "an open
question" implicitly (nowhere is it named at all) rather than resolving it.

**Evidence:** `checkRequiredOrDeclined` in `shared.ts`; `JOURNAL_DECLINABLES`
in `journal.ts` growing already (from `["tagline"]` to `["tagline",
"figures"]` in the same file, in one PR); `content.md` §3 and BRIEF.md rule
2 stating the 422 behaviour as universal and permanent, with no phase-in
language anywhere in the eight design docs.

**Recommendation:** Pin the advisory mechanism down explicitly, in the core
schemas, before shipping a second declinable field: a new required/
declinable section starts life *optional and unenforced* (accepted if sent,
silently not-422'd if absent) for a stated minimum window — the
`Deprecation`-header pattern in reverse, an "Advisory-Until" instant
returned in the 200/PATCH response and in `/api/v2/{user}/status`, after
which the field becomes enforced. Only after that window may
`checkRequiredOrDeclined` start listing it. Without this, "no v3" is a
promise the code cannot keep — v2 will break clients on an undocumented
cadence exactly as often as a v3 would have, just without a version number
to blame it on.

---

## 2. The "no v3" claim is contradicted by rule 6 (client id collisions) and rule 4 (server-owned field additions) — both are breaking under `strictObject` too

**Risk:** Rule 6's `409 + stored document` on a retried create is itself
fine, but any *server-owned* field added later (rule 4's "read shape is
write shape plus server-owned truth *in the same fields*") is a write-side
`strictObject` rejection risk the moment a client that pre-dates the new
field echoes back what it just read (a common, reasonable client pattern:
GET, modify one field, PUT the whole document back). `strictObject` on the
write schema will reject the new server-owned key the old client is
blindly echoing back, unless every server-owned addition is also added to
an allow-but-ignore list on write. No such list exists in the code read.

**Evidence:** `status.ts`'s `journalDoc`/`tripDoc` pattern of spreading
`base.def.shape` plus server-owned keys (`figures.ts` `figureDoc`, `trip.ts`
`tripDoc` patterns) — read shape and write shape are the same
`strictObject`, so nothing distinguishes "you may echo this back
unmodified" from "you may not send this at all".

**Recommendation:** Either (a) writes must strip known server-owned keys
before validating (a `.omit()` on the write schema per addition — cheap,
mechanical, and testable), or (b) the write schema should be
`.catchall(z.never())` only on genuinely client-authored keys and tolerant
of the specific server-owned key set, generated from the same source the
read schema uses. Document whichever is chosen as a standing rule next to
rule 4, because right now nothing prevents the exact GET→PUT round-trip
bug this design otherwise prides itself on eliminating.

---

## 3. The one-serializer promise is already broken in writing, by the design's own admission — journal.ts drops `startLocation` and `features` on the next v2 write

**Risk:** `journal.ts`'s header comment states plainly: *"`features` —
… A block in an existing config.json parses and is ignored. `startLocation`
— stored and editable in v1, … v1 keeps parsing it from old files."* Per
BRIEF rule 1 ("written whole"), a v2 PATCH is a JSON Merge Patch applied to
the validated document and the document is then **rewritten whole** from
the v2 schema. A v2 schema that does not carry `startLocation` or
per-journal `features` cannot re-emit keys it never parsed. The very first
`PATCH /api/v2/{user}` against any journal that has a `startLocation` or a
narrowing `features:` block in `config.json` (AGENTS.md: *"A user's own
config.json may narrow these"* — so this is a real, supported, currently
live field, not a hypothetical) silently deletes it from the file. That is
not "v1 keeps parsing it" — v1 will have nothing left to parse once a
single v2 write has landed.

**Evidence:** `journal.ts` header comment (quoted above); `lib/config.ts`
line 794/916, `startLocation` and per-journal `features` both read from
`config.json`; AGENTS.md's explicit statement that a journal's own
`config.json` narrows the operator's ceiling.

**Recommendation:** This is not a "join v2 if a feature ever wants it"
question — it is a data-loss bug waiting on day one of parallel-write. Two
honest fixes: (a) the v2 write path preserves unknown top-level keys on the
underlying file verbatim (read-merge-write at the *file* layer, validate
only the keys v2 knows, not a `strictObject` round-trip through a schema
that has amnesia for the rest) — this is the standard "preserve unknown
fields" tolerant-writer pattern; or (b) v2 refuses to write `config.json` at
all for a journal that still has `startLocation`/`features` set, until an
explicit migration step has moved them somewhere v2 does track (or
confirmed dead). Ship neither and "one serializer, byte-identical" is false
from the first PATCH.

---

## 4. `tracks:` cut (content.md §4) is the same class of loss, deliberately taken, but the migration ledger's mitigation ("no retroactive rewrite… the requirement only bites going forward") hides a live-trip regression

**Risk:** `content.md` proposes cutting the trip-level `tracks:` toggle
entirely, replacing a one-time trip-level decline with a per-day
`declined: {costs: "..."}` repeated on every day. The ledger's own honest
admission: *"a real regression for a long trip with many days"* unless
client tooling remembers the trip's standing answer. But the mitigating
claim — *"no retroactive rewrite of existing content is needed since the
requirement only bites at publish-time completeness checks going
forward"* — is optimistic, not proven: an existing trip mid-migration, with
some days already published and some still draft, is now asked to retroactively
decline costs per day for every day that has not yet been published, with
no tooling named that will actually do this (the BYOA agent problem from
Finding 6 below applies here directly — most `tracks:`-relying trips are
run by an agent that has never seen this design doc).

**Evidence:** `content.md` §4, full section transcribed above; the trip's
`tracks:` cut is filed only as "an open question" (§14, not read in full
here but referenced at content.md's own §4), i.e. **not yet decided by the
owner**, while the migration ledger already assumes the cut is taken.

**Recommendation:** Do not let the migration ledger presuppose the outcome
of an open question. If the owner keeps `tracks:`, the mechanism can be
translated 1:1 into a trip-level `declined` default that a day inherits
unless it overrides — cheaper than losing the feature and consistent with
"one mechanism" (the day's decline map just gets a default value sourced
from the trip document, no second vocabulary). Resolve this before phase 2
(parallel v2) starts, not during it.

---

## 5. Figures data migration is a real one-way script with no dry-run, no rollback path named, and ids invented by the script itself contradict rule 6

**Risk:** `content.md` §7's migration ledger: *"a `travellers:` block …
becomes one or more `figureDoc`s in a new `figures/` store … this needs a
real migration script, not a passive dual-read, since v1's inline figures
have no `id` of their own … each entry gets a generated id, e.g.
`slugify(name ?? "figure-N")`."* Three problems stack here: (a) this is the
only data migration among the eight design docs that is not "passive" —
every other one is "old files keep parsing, nothing rewrites them" — so it
is the one place an actual one-shot script runs across every journal's
files, and no rollback, dry-run, or idempotency story is given for it; (b)
the generated id is server-invented, which directly contradicts rule 6
("client-chosen ids everywhere") for the one resource that most needs
stable ids (a figure referenced by a photobook run months later); (c) the
script must run "before v2 figure reads are correct" per the same
paragraph — but nothing says whether it runs once, globally, in phase 2, or
lazily per-journal on first v2 touch, which matters enormously for when a
BYOA agent reading `GET /api/v2/{user}` for the first time sees a journal
whose figures have not yet been migrated (empty library? 500? stale v1
shape leaking through?).

**Evidence:** `content.md` §7 migration ledger, quoted above in full.

**Recommendation:** Name the trigger (global batch script run once during
phase 2, with `figures/` populated before `/api/v2` is exposed for that
journal at all — not lazy, not on-touch) and name the collision policy for
`slugify(name)` clashing across multiple travellers with the same first
name in one journal (a real case: "Mum" and "Mum" on a family trip). Treat
the generated id as provisional and let the owner rename it once, since a
figure id embedded in years of trip documents is exactly the kind of
permanent reference rule 6 exists to avoid inventing carelessly.

---

## 6. Deprecation mechanics for BYO agents are entirely unaddressed — no Sunset/Deprecation headers, no version discovery, no read path for "is v1 going away"

**Risk:** None of the eight area docs nor BRIEF.md mention `Sunset`,
`Deprecation`, or any RFC 8594/9745-style signal on v1 routes during the
parallel-run phase. The phase order in `tickets.md` (*"schemas → parallel
v2 → helper rewired → webapp → v1 sunset"*) has a named terminal phase
("v1 sunset") with no described mechanism for telling a BYOA agent — which
by definition this project cannot patch, redeploy, or notify by any channel
except HTTP itself — that the door it has always called is closing. Per
AGENTS.md's own philosophy (a BYOA has "the document and nothing else — no
source to read, no colleague to ask"), the *only* channel available to warn
it is response headers and `/documentation.txt`/`/skill/*.md` prose, and
none of the docs propose using it.

**Evidence:** `tickets.md` line 52 (the five-phase order, unglossed);
absence of "Sunset"/"Deprecation" anywhere in the eight docs (grep
confirms zero hits outside this file).

**Recommendation:** From the day parallel v2 goes live, v1 responses carry
`Deprecation: <date>` and, once a sunset date is fixed, `Sunset: <date>`
(RFC 8594 IMF-fixdate) plus `Link: <.../api/v2/...>; rel="successor-version"`.
`/documentation.txt` and `GET /api/v1/{user}/status` should say the same
date in prose, since a header is invisible to a model reading the
documentation rather than inspecting response headers. Sunset only after a
stated minimum notice period (6–12 months is the researched norm) has
elapsed **after** helper and webapp cutover are verified complete — not
calendar time from parallel-v2's launch.

---

## 7. v1/v2 parallel writes to the same markdown have no described conflict rule — last-writer-wins across two independently-versioned serializers is a silent corruption path

**Risk:** During "phase 2, parallel v2" (helper still on v1, an early BYOA
already speaking v2), both API surfaces can write the same `trip.md` or day
file concurrently. v1's writer and v2's writer are, per Finding 3, *not*
the same code (v2 either round-trips through a `strictObject`-typed
document that drops unknown keys, or a separate merge-at-file-layer path
nobody has designed yet). No document describes a lock, an ETag/
If-Match precondition, or even a stated "last write wins, and here is what
that means for a field the other version doesn't know about." Two writers
racing on one file, one of which forgets fields the other cares about, is
the concrete mechanism by which Finding 3's data loss actually happens in
production rather than only in the worst case.

**Evidence:** No mention of concurrency control, ETags, or file locking in
any of the eight docs; `content.md`'s repeated "no data migration" claims
implicitly assume single-writer-at-a-time, which phase 2 by construction is
not.

**Recommendation:** Either (a) v2 write paths carry an `If-Match` precondition
against a content hash/mtime the GET returned, refusing with `409
conflict` on a stale write (cheap, standard, and it also protects two v2
clients from each other) — or, if that is thought too heavy for phase 2,
(b) explicitly document that v1 remains the sole writer for any field v2
doesn't model (Finding 3's set) for the duration of parallel-run, and v2
writes are refused outright on a document that still carries a field v2
does not understand, rather than silently dropping it. Silence on this is
the actual highest-severity gap in the whole migration plan.

---

## 8. The parity test's blind spots: nothing named tests the 422-shape, the `declined` retraction invariant, or file-level round-trip under concurrent access

**Risk:** No document in this set describes a "parity test" at all —
the term appears only in the task brief, not in the design docs — which is
itself the finding: a five-phase migration with a parallel-run phase and no
named consumer-driven contract test (comparing v1 and v2 responses/writes
for the same operation) has no mechanical way to catch Findings 1–3 before
a real journal hits them. The one adjacent thing that *is* named,
`test/openapi-contract.test.ts` and `test/api-route-schemas.test.ts` (per
AGENTS.md), check that v2's contract is internally consistent — schema
matches openapi matches enum source — never that v1 and v2 agree on the
same document, or that a byte written by v2 and re-read by v1 (or vice
versa) round-trips.

**Evidence:** AGENTS.md's description of the two existing contract tests
(internal-consistency only); absence of any parity/dual-write test
mentioned across BRIEF.md or the eight area docs.

**Recommendation:** Add, before phase 2 opens, a test that: for a sample of
real (or fixture) journals, writes the same logical change through v1 and
through v2, and asserts the resulting file bytes are either identical or
differ only in ways both readers tolerate. This is the direct mechanical
check for Finding 3's data-loss claim and would have caught the
`startLocation`/`features` drop before it shipped as a code comment
instead of a bug report.

---

## 9. Helper cutover atomicity: no described flag or rollback between "helper rewired" and "webapp" phases, and B1577's `doors` retirement is entangled with it

**Risk:** `tickets.md` treats "helper rewired onto v2" and "webapp [on v2]"
as two sequential phases, with B1577's `content-model.json` doors mechanism
named as dead weight only *after* both land. But the helper is the
project's most active writer (every persona-driven flow in
`test-with-personas`) and nothing describes how the cutover itself happens
— a config flag flipped instance-wide (all-or-nothing, no partial rollout,
no canary), or per-journal, or per-request. If it is instance-wide and
atomic, a mid-flight `/agent` conversation active at the flip moment is
either silently talking to the wrong version or dropped; if it is
per-journal, the parallel-write hazard in Finding 7 is now permanent for
whichever journals lag, not transitional.

**Evidence:** `tickets.md` line 52 states the order as a bare sequence with
no mechanism; B1577's row explicitly ties its own retirement to "once
helper is rewired onto v2" with no described trigger.

**Recommendation:** Name the cutover unit (recommend: per-journal flag,
since journals are already the sharding boundary everywhere else in this
codebase — `content/<username>/`) and state explicitly that a journal
flagged onto v2-helper stays there — no flapping — and that Finding 7's
write-conflict guard is what makes a straggling v1-helper journal safe to
leave mid-migration rather than urgent to force.

---

## 10. `figureDoc`'s from-photo capability has no v2 home decided, and the "closer in spirit to geocode" framing quietly proposes a third contract shape mid-migration

**Risk:** `content.md` §7 flags `.../travellers/from-photo` as unresolved,
suggesting it is "closer in spirit to `geocode` (a shortlist to choose
from) than to a document write" — i.e. a stateless advisory route outside
the whole-document write model. That is a reasonable design call, but it
means the v2 contract will grow a *second* interaction shape (propose-then-
separately-write, distinct from the declared "whole resource read/write"
rule 1) mid-migration, decided as a side note in one area doc rather than
as a core-schema decision reviewed the way trip/day/journal/figures/media
were. Given Finding 1's evidence that the declinable-field list is already
growing ad hoc between commits, a second undecided-but-shipped shape
compounds the same problem: the core contract is not as closed as "phase 0"
implies.

**Evidence:** `content.md` §7, `from-photo` paragraph; BRIEF.md rule 1
("Document-oriented, few doors… No per-field routes") which `geocode`-style
shortlist routes are already a sanctioned, if narrow, exception to.

**Recommendation:** Fold this into the same core-schema review pass the
other five resources got, explicitly enumerating "advisory, no-write"
routes as a named third category in rule 1 (alongside document read/write
and the safety-shape exceptions of rule 9) rather than letting each area
doc invent its own justification for why its one non-conforming route is
fine.

---

*Not ranked further: two smaller items worth a line each — (a) `journalPatch`
being `base.partial()` means a PATCH can legally clear `locales` to an empty
array only if `.min(1)` is dropped under `.partial()` (Zod's `.partial()`
does not relax internal array-length constraints, so this is probably fine,
but worth a dedicated test given how much of this migration rests on
Zod's own default behaviour rather than an explicit assertion); (b) the
`declined` retraction invariant (Finding, B1564) is filed as "absorb into
v2" but content.md never actually specifies it as a schema-level rule in
the read documents — it should be visible in `day.ts`'s own comments, not
only in the ticket scan.*
