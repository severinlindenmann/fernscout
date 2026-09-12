# v2 area design — Auth & Credentials

Scope: everything under `app/api/auth/`, the owner-only key console
(`app/api/v1/[user]/keys`), and the credential model itself —
`lib/auth/index.ts`, `lib/auth/handshake.ts`, `lib/auth/identityCookie.ts`,
`lib/api/auth.ts`. This area has a full redesign mandate. Nothing here
touches `app/api/v1/[user]` document routes (trip/day/journal) beyond citing
how a bearer token's scope surfaces on `GET /api/v2/{user}/status`, which is
decided core.

## 0. The properties that do not move

These are load-bearing (decision 24, B283, B410, B230, B142, B1559) and this
redesign keeps every one of them, only reshaping the doors around them:

1. **Bearer ≠ cookie, structurally.** A write credential (agent token) is
   presented only as `Authorization: Bearer`; a read credential (guest
   cookie) and the identity cookie are presented only as httpOnly cookies.
   `resolveSession(token, expectedKind)` refuses a token presented down the
   wrong channel or minted as the wrong kind — this is the single choke
   point and it stays the single choke point.
2. **An identity authorises nothing.** It proves an address instance-wide;
   every journal still re-derives access from `people:`, grants and
   `config.json` on every request (`resolveAccess`).
3. **A handover credential can only be exchanged**, never used to read or
   write, and lasts 20 minutes — because the guest cookie that mints it
   lasts a year, and printing a 7-day agent token there would make that
   year-old cookie the real ceiling.
4. **A signup token can create exactly one journal** and nothing else.
5. **A trip-scoped token's width is decided when the code is issued**, from
   server-side knowledge of who is on the trip — never re-read from the
   request body at redemption (B230's lesson: a field the caller resends is
   a field the caller can omit to get more than they asked for).
6. **Every code-request endpoint answers uniformly** for anything that
   depends on the address (202, always) and only ever answers differently
   for things that do not (malformed input, rate limit, capability off,
   send failure) — except the one deliberate, argued exception: an agent
   code for an address that does not own the journal or sit on the named
   trip answers `403` truthfully, because the cost of silence there fell on
   an honest agent that could not tell "wrong address" from "still
   delivering."
7. **A link is spent by `POST`, never by `GET`.** B142: a mail scanner
   follows links; it does not submit forms. This is why every redemption
   door in this design is a `POST`.
8. **Failure to send takes the code back.** `issueCode` supersedes every
   live code for the address; a guarded send failure that did not revoke
   would kill the code the person is still holding and leave a live one
   nobody was ever told.

## 1. Inventory — every v1 route and capability

| Route | Verb | Does | Credential in / out |
|---|---|---|---|
| `/api/auth/request` | POST | Issue a one-time code: guest (`kind:"guest"`) or agent (`kind:"agent"`, optional `trip`), by mail or WhatsApp (`channel`) | none in → mailed/WhatsApp code |
| `/api/auth/verify` | POST | Redeem that code | code in → guest cookie **+ identity cookie**, or agent token in body |
| `/api/auth/link` | POST | Redeem the one-click link a guest code's mail carries | link token in → guest cookie **+ identity cookie** |
| `/api/auth/logout` | POST | Revoke and clear both cookies | guest + identity cookies in → cleared |
| `/api/auth/handover` | POST | Exchange a 20-minute handover credential for a 7-day agent token | handover bearer in → agent token |
| `/api/v1/{user}/handover` | POST | **Mint** the handover credential (owner's browser page) | owner cookie or bearer in → handover token |
| `/api/auth/identity/request` | POST | Issue an identity code (address-only, no journal) | none in → mailed code |
| `/api/auth/identity/verify` | POST | Redeem it | code in → identity cookie |
| `/api/auth/identity/link` | POST | Redeem the identity one-click link | link token in → identity cookie |
| `/api/auth/identity/upgrade` | POST | Mint an identity cookie from an existing guest cookie, no code round trip | guest cookie in → identity cookie |
| `/api/auth/signup/request` | POST | Issue a signup code (address-only) | none in → mailed code |
| `/api/auth/signup/verify` | POST | Redeem it for a signup token (creates zero journals; good for one `POST /api/v1/journals`) | code in → signup token |
| `/api/auth/signup/phone/request` | POST | Start phone proof on a signup token — SMS code, or a WhatsApp inbound link to poll | signup bearer in → SMS/poll started |
| `/api/auth/signup/phone/verify` | POST | Check the SMS code, or poll the inbound link | signup bearer in → phone proven on the session |
| `/api/v1/{user}/keys` | GET | List live write-capable sessions (`agent`, unspent `handover`) — owner sees all, a proven non-owner address sees only their own | owner cookie/bearer, or guest cookie/identity/bearer for self |
| `/api/v1/{user}/keys` | POST | Revoke one, by id | same as above |

**Capabilities gating this area:** `auth`, `signup`, `mail`, `whatsapp`
(`FEATURE_NAMES`, `lib/config.ts`) — each is both a server-wide switch and,
for `auth`/`signup`, a per-journal one (`isEnabled(name, user)`).

**Not in this area but adjacent, for completeness of the boundary:**
`POST /api/v1/journals` (spends a signup token to create a journal — trip/
journal area's door, not this one's) and `resolveAccess`/`resolveIdentity`
in `lib/auth/handshake.ts`, which every page and every other API route calls
to ask "who is this" — unchanged by this redesign, since nothing here
touches how a *reader* is resolved, only how a *credential* is obtained.

## 2. v2 design

### 2.1 The wire vocabulary: `for`, not `kind`

**Cut:** the request field `"kind": "guest" | "agent"`. In a product whose
own language calls the caller "an agent" regardless of whether it is
reading or writing (`/agent.md`, `/documentation.txt`), asking a body for
`"kind": "agent"` to mean *specifically the write credential* is exactly
the kind of internal jargon leaking onto the wire that costs a caller a
support round-trip. `SESSION_SCOPE` already names the two things plainly —
`"read"` and `"write:content"` — so v2 uses that:

```ts
// new: lib/api/v2/schemas/auth.ts — imports SessionKind's vocabulary,
// never retypes it (rule 12). CREDENTIAL_FOR is the source constant.
export const CREDENTIAL_FOR = ["read", "write", "identity", "signup"] as const;
```

`read` = today's `guest`, `write` = today's `agent`, `identity` and
`signup` are unchanged in meaning. Internally `lib/auth`'s `SessionKind`
(`"guest" | "agent" | "signup" | "handover" | "identity"`) is untouched —
this is a translation at the HTTP boundary, not a rename of the session
model. `handover` never appears as a `for` value on the code/link doors: it
is minted and exchanged by its own pair of routes (§2.5), never by code.

### 2.2 Codes — `/api/auth`, no credential in

Three near-identical v1 pairs (`/api/auth/request`+`verify`,
`/api/auth/identity/request`+`verify`, `/api/auth/signup/request`+`verify`)
collapse into one pair, parameterised by `for`. The duplication in v1 was
not cosmetic risk: it is three copies of the rate limit, the uniform-202
rule, the mail-failure-revokes-code guard, and the capability check, each
one a place a fourth kind (WhatsApp signup, say) could be added to two of
three and missed on the third. One door means one place to get it right.

**`POST /api/auth/codes`** — issue a one-time code.

Request schema:

| Field | Type | Class | Notes |
|---|---|---|---|
| `email` | `string` | required | checked for shape only (`isEmail`), never existence — existence is never disclosed except where noted below |
| `for` | enum `CREDENTIAL_FOR` | required | which credential this code will redeem into |
| `user` | `string` | conditional | required when `for` is `"read"` or `"write"` (the code is *for* a journal); refused (`unsupported_field`) when `for` is `"identity"` or `"signup"` — those name no journal, by design (`NO_JOURNAL`) |
| `scope` | `{trip: string}` | conditional | only meaningful when `for:"write"`; names the one trip this code may mint a token for. Absent + owner's own address = the journal-wide token. Absent + a non-owner address = refused. Refused outright when `for` is anything else |
| `channel` | enum `["mail","whatsapp"]` | optional | default `"mail"`. `"whatsapp"` is refused (`whatsapp_disabled`, shape-level, not address-dependent) unless the server has WhatsApp on; whether it actually sends is address-dependent (only the owner's own proven number) and stays silent-202 either way — see refusals |
| `destination` | `string` | optional | a path inside this journal to land on after redeeming a link; only meaningful with `for:"read"`. Checked by the same `safeDestination` as v1, stored, never echoed |
| `locale` | `string` | optional | overrides the browser's `Accept-Language` for the mail's language — carried over from B1134/B857 for the doors that have no journal to read a default off (`identity`, `signup`) |

Example request:

```json
POST /api/auth/codes
{"email": "mira@example.com", "for": "write", "user": "mira", "scope": {"trip": "alps-2026"}}
```

Response (always `202`, unless refused for a reason listed below):

```json
{"status": "accepted", "next": "POST /api/auth/codes/redeem with {\"email\", \"code\", \"for\": \"write\"}"}
```

Refusals:

| Status | error | When |
|---|---|---|
| 404 | `auth_disabled` / `signup_disabled` | server-wide or per-journal switch off (the latter only for `for:"read"/"write"`, checked once `user` resolves to a real journal) |
| 503 | `mail_disabled` / `whatsapp_disabled` | the chosen channel cannot be delivered at all — checked before issuing, so a live code is never silently killed for an undeliverable replacement |
| 429 | `too_many_requests` | per-IP bucket, narrower for `for:"write"` than for `for:"read"` — an agent code answering `403` for the wrong address (below) is the one thing on this door that must stay slow to try |
| 400 | `invalid_email` / `invalid_request` | shape only — malformed address, missing `user` where required, `user`/`scope` present where refused |
| 403 | `not_authorised` | **address-dependent, deliberately not silent** — `for:"write"` and the address is neither the journal's owner nor on the named trip (§0.6) |
| 202 | *(silent)* | every other address-dependent outcome: unknown `user`, unknown address, WhatsApp requested for a non-owner or unproven number, either WhatsApp ceiling exceeded, either email ceiling exceeded |
| 503 | `mail_failed` / `whatsapp_failed` | the chosen channel accepted the request but the send itself failed — the code is revoked before this is returned |

**`POST /api/auth/codes/redeem`** — spend a code.

| Field | Type | Class | Notes |
|---|---|---|---|
| `email` | `string` | required | |
| `code` | `string` | required | six digits |
| `for` | enum `CREDENTIAL_FOR` | required | must match what the code was issued as — `invalid_code` otherwise, same envelope as a wrong code (§0.6's sibling: redemption must not distinguish "wrong `for`" from "wrong code") |
| `user` | `string` | conditional | required with `for:"read"/"write"`, refused otherwise — same rule as issuance |
| `scope` | `{trip: string}` | optional | for `for:"write"` only, and may only **repeat** the trip already bound to the code (B230) — naming a different one is `invalid_code`, the same non-disclosing refusal as everything else on this door |

Response, `for:"read"` or `for:"identity"` — sets the cookie(s), returns no
token in the body:

```json
{"ok": true, "expires": "2027-09-12T10:00:00Z", "scope": "read"}
```

`for:"read"` also mints the identity cookie in the same response, exactly
as v1's `/api/auth/verify` does (§0 property 2's corollary: proving an
address for one journal proves the address) — guarded, so a database
hiccup minting the bonus identity never turns a successful sign-in into a
failure.

Response, `for:"write"` or `for:"signup"` — the token is the whole body,
never a cookie:

```json
{"ok": true, "token": "fs_write_…", "expires": "2026-09-19T10:00:00Z", "scope": "write", "user": "mira"}
```

Refusals: `auth_disabled`/`signup_disabled` (404), `too_many_requests`
(429), `invalid_request` (400, shape), `invalid_code` (401, uniform — no
code, expired, wrong, burned, wrong `for`, or a `scope.trip` that does not
match the bound code, all answer identically, per §0.6's converse: a
*caller holding no code* must not be able to learn anything about someone
else's by trying values here).

### 2.3 Links — `/api/auth/links/redeem`

One door replaces `/api/auth/link` and `/api/auth/identity/link`. `POST`
only (§0.7).

| Field | Type | Class | Notes |
|---|---|---|---|
| `token` | `string` | required | the link's own token, from the URL |
| `for` | enum `["read","identity"]` | required | a link only ever exists for these two — an agent has no browser to follow one, and a signup link would quietly create a journal on arrival, which nobody has ever wanted |
| `user` | `string` | conditional | required with `for:"read"`, refused with `for:"identity"` |

Response mirrors `codes/redeem`'s `for:"read"`/`"identity"` shape, plus
`next`, the safe-checked landing path:

```json
{"ok": true, "next": "/mira/trips/alps-2026"}
```

Refusals: `not_found` (404, unknown `user`/journal-level `auth` off — same
disclosure posture as today), `too_many_requests` (429), `link_spent`
(401, uniform for "never existed", "already spent" and "expired" — the
token is 256 bits so there is nothing here worth distinguishing for an
attacker, but a *caller* is told the same as today: try
`POST /api/auth/codes` again).

### 2.4 Cookie-lifecycle doors — unchanged shape, carried over as-is

**`POST /api/auth/identity/upgrade`** — mint an identity cookie from a live
guest cookie, no code. Same behaviour as v1: idempotent
(`{"ok": true, "issued": false}` if one already exists), rate-limited,
`no_session` (401) with no cookie at all. No redesign needed — it is
already the smallest possible door for what it does.

**`POST /api/auth/logout`** — revoke and clear both cookies, server-side
and in the browser, in one call. Unchanged.

### 2.5 Handover — split mint from exchange, on separate paths

**Cut the mixed prefix.** V1 mints the handover credential at
`/api/v1/{user}/handover` (document-API-shaped path, but cookie/bearer
credential, no document involved) and exchanges it at `/api/auth/handover`
(auth-shaped path). v2 keeps both steps inside `/api/auth`, since minting
and exchanging a credential is what `/api/auth` is *for* regardless of
which journal it is scoped to — the `{user}` segment is still needed
because the credential names a journal, the same way a trip-scoped code
does.

**`POST /api/auth/{user}/handover`** — mint. **The one deliberate exception
to "one credential per route" in this design**, carried over unchanged from
B776: the owner's page reaches this with their guest cookie, *and* a live
agent token may reach it with its own bearer to renew itself before it
expires (a week-long job surviving past seven days without the owner
re-entering a code). Both are checked by the same `isOwner`-shaped guard
the invites door already uses. No request body. Response:

```json
{"token": "fs_handover_…", "expires": "2026-09-12T10:20:00Z"}
```

Refusals: `auth_disabled` (404, server- or journal-level), `forbidden`
(403, not the owner by either credential).

**`POST /api/auth/handover`** — exchange. Bearer-in (the handover token
itself, refused down any other channel), agent token out. Unchanged from
v1 beyond the path already living under `/api/auth`. Refusals:
`auth_disabled` (404), `missing_token` (401), `invalid_handover` (401,
uniform for expired/spent/wrong-kind).

### 2.6 Signup — codes door handles the address, phone stays its own pair

`for:"signup"` on `/api/auth/codes` + `/api/auth/codes/redeem` replaces
`/api/auth/signup/request` + `/api/auth/signup/verify` (§2.2). The phone
step does **not** fold into the codes door — it is structurally different
(an `id` per attempt, a poll-with-no-code mode for WhatsApp-inbound, its
own three-tier rate ceiling) and forcing it into the code shape would
either lose the poll mode or bloat the generic door with fields that mean
nothing outside signup. It keeps its own pair, renamed for consistency
with `codes/redeem`:

**`POST /api/auth/signup/phone`** (was `.../phone/request`) — bearer: the
signup token. Body: `{tel}` (E.164, required unless the server is in
`whatsapp-inbound` mode, where it takes none) or `{channel: "sms"}` to use
the SMS fallback inside inbound mode. Unchanged behaviour otherwise —
three ceilings (number/address/instance), `sms_unreachable` refused before
any ceiling is spent, inbound mode returns a link + prepared message to
poll.

**`POST /api/auth/signup/phone/redeem`** (was `.../phone/verify`) — bearer:
the signup token. Body: `{id, code?}` — `code` present checks an SMS/App
code, absent polls an inbound link. Unchanged behaviour: `markPhoneProven`
writes `phone`/`phoneProvenAt`/`phoneProvenMethod` onto the signup session,
read by `POST /api/v1/journals` (out of this area's scope) rather than
trusted from the create-journal body.

### 2.7 Keys — journal's live write-capable credentials

**Cut the mixed-credential single route**, deliberately, unlike handover.
V1's `/api/v1/[user]/keys` accepts an owner (cookie or bearer) *or* a
non-owner who has proved their own address (guest cookie, identity cookie,
or their own trip-scoped bearer) and filters server-side to that address's
rows. That is real and worth keeping (B323: a buddy revoking their own
leaked key without the owner's involvement) — but "GET works for three
different credential shapes, none of which is in the URL or the header
name" is exactly the ambiguity the four-prefix rule exists to remove, and
handover's exception above is already spending this design's one
allowance for it. Two doors instead:

**`GET`/`POST /api/auth/{user}/keys`** — owner only, cookie or bearer
(`isOwner`'s existing dual check — an owner's *own* agent token counts, the
same as today). Sees and may revoke every live `write`/`handover` row.

**`GET`/`POST /api/auth/{user}/keys/mine`** — self-service, cookie
(guest/identity) or bearer (a `write` token), scoped by construction to the
caller's own proven address — never a parameter, never widened. A stranger
holding neither gets `forbidden` (403) rather than `404`, matching v1's
reasoning: refusing after ownership/address is established never confirms
or denies journal existence, because both routes 404 for a nonexistent
`{user}` before the credential is even checked.

Read schema (both doors — `mine` simply omits `email` per row, since every
row shown is already the caller's own):

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | server-owned |
| `kind` | `"write"` \| `"handover"` | translated from `SessionKind` per §2.1 |
| `scope` | `"owner"` \| `{trip: string}` | same shape as `journalStatus.token.scope`/`trip` (core, §3) — one vocabulary for "what can this credential do", whether asked about itself or listed by the owner |
| `createdAt`, `expiresAt`, `lastSeenAt` | `string \| null` | server-owned |
| `email` | `string` | owner door only |

Write: `POST {"revoke": "<id>"}`. Refusals: `unknown_key` (404, wrong
journal or, on `mine`, not this caller's row — same non-disclosing answer
either way), `auth_disabled` (409, matching v1: the journal exists, the
feature is off), `invalid_request` (400, missing `revoke`).

## 3. Token scope — expression and discovery

This ties into the decided core's `journalStatus.token`:

```ts
token: z.strictObject({
  scope: z.enum(["owner", "trip"]),
  trip: z.string().optional(),
  expiresAt: z.string(),
}),
```

v1's internal scope is a string — `"write:content"` or
`"write:trip:<id>"` — minted at `openSession` and read back by
`mayActAsOwner`/`mayWriteTrip`/`tripWriteVerdict`. **v2 never puts that
string on the wire.** `GET /api/v2/{user}/status` is where a token
discovers its own width, by translating the internal scope the same way
`§2.7`'s key listing already does:

- an owner's own token, or the instance admin's (`isAdminEmail`, B480)
  widening onto a journal it does not literally own → `{scope: "owner"}`
- a trip-bound token → `{scope: "trip", trip: "<id>"}`

**One function does this translation, called from both places.** v1 had
two independent readings of the same fact (the `/keys` route's
`row.scope` string shown raw to the owner, and `mayWriteTrip`'s own parsing
of it) — v2 exports `describeScope(session): {scope, trip?}` from
`lib/auth` and both `GET /api/v2/{user}/status` and
`GET /api/auth/{user}/keys` call it, so "what can this token do" has one
answer regardless of which door asked.

**Why not richer scopes (read-only within write, per-field grants, etc.).**
Nothing in v1 needs it — every write door already re-derives the *real*
per-trip verdict at call time from `people:` and grants
(`tripWriteVerdict`, B98), so the token's own scope only ever needs to
answer "which trip, or all of them" — a token is not the source of truth
for what it may do today, only for which journal and which trip it is
*for*. Widening this vocabulary would be inventing a second, weaker source
of truth beside the one that already exists. **Recommendation: keep the
two-value enum as-is; do not add anything to it in this redesign.**

## 4. Proposed cuts

1. **Merge the three request/verify pairs into one parameterised pair**
   (§2.2). Argued above — not a feature cut, a duplication cut. Replaces:
   `/api/auth/request`, `/api/auth/verify`, `/api/auth/identity/request`,
   `/api/auth/identity/verify`, `/api/auth/signup/request`,
   `/api/auth/signup/verify` → `/api/auth/codes`,
   `/api/auth/codes/redeem`.
2. **Merge the two link doors into one** (§2.3). Replaces
   `/api/auth/link`, `/api/auth/identity/link` →
   `/api/auth/links/redeem`.
3. **Rename `kind` → `for`, and `"guest"/"agent"` → `"read"/"write"`** on
   the wire (§2.1). A vocabulary change only — `SessionKind` internally is
   untouched.
4. **Move `/api/v1/{user}/handover` → `/api/auth/{user}/handover`**
   (§2.5). It issues a credential and touches no document; it belongs with
   the rest of the credential family, not the document API.
5. **Move `/api/v1/{user}/keys` → `/api/auth/{user}/keys` +
   `/api/auth/{user}/keys/mine`** (§2.7), splitting the mixed-credential
   route in two. Argue against, if the owner would rather keep one door:
   the mixed-credential shape was never actually confusing in practice (one
   ticket, B323, added it deliberately and nothing since has complained) —
   splitting it is optional cleanliness, not a fix for an observed problem,
   and doubles the number of routes to maintain for one endpoint. **Given
   this, treat #5 as the weakest cut in this list** and default to keeping
   it as one door if the owner would rather not pay the extra route.
6. **Nothing else is cut.** Every v1 capability — dual delivery channel,
   inbound WhatsApp phone polling, the SMS fallback inside it, standing and
   relay links, the trip-binding-at-issue rule, the uniform-202 posture,
   the address-dependent `403` on agent codes — is preserved; only the
   route count and the field names around them change.

## 5. Migration ledger

**Reused as-is (no code change):** `lib/auth/index.ts` in full —
`issueCode`, `verifyCode`, `verifyLink`, `openSession`, `openIdentitySession`,
`issueHandover`, `exchangeHandover`, `markPhoneProven`, `listSessions`,
`revokeSession`, `resolveSession`, `SESSION_TTL_MS`, `SESSION_SCOPE`,
`tripWriteScope`, `safeDestination`, `pendingCodeTrip`. `lib/auth/handshake.ts`
and `lib/auth/identityCookie.ts` in full. `lib/api/auth.ts` in full
(`authenticate`, `ownsUser`, `mayActAsOwner`, `mayWriteTrip`,
`writableTrips`) — every write door outside this area keeps calling these
unchanged.

**New, small:** `describeScope(session)` in `lib/auth`, exported for
`GET /api/v2/{user}/status` and the keys doors (§3) — the one place that
turns `session.scope` into `{scope, trip?}`. `lib/api/v2/schemas/auth.ts`
for `CREDENTIAL_FOR` and the request/response zod shapes in §2.

**Rewritten (routing + body-shape only, not the underlying calls):**
- `app/api/auth/request/route.ts` + `app/api/auth/identity/request/route.ts`
  + `app/api/auth/signup/request/route.ts` → `app/api/auth/codes/route.ts`
- `app/api/auth/verify/route.ts` + `app/api/auth/identity/verify/route.ts`
  + `app/api/auth/signup/verify/route.ts` →
  `app/api/auth/codes/redeem/route.ts`
- `app/api/auth/link/route.ts` + `app/api/auth/identity/link/route.ts` →
  `app/api/auth/links/redeem/route.ts`
- `app/api/v1/[user]/handover/route.ts` →
  `app/api/auth/[user]/handover/route.ts`
- `app/api/v1/[user]/keys/route.ts` →
  `app/api/auth/[user]/keys/route.ts` +
  `app/api/auth/[user]/keys/mine/route.ts`
- `app/api/auth/signup/phone/request/route.ts` →
  `app/api/auth/signup/phone/route.ts` (rename only)
- `app/api/auth/signup/phone/verify/route.ts` →
  `app/api/auth/signup/phone/redeem/route.ts` (rename only)

**Unchanged paths:** `app/api/auth/identity/upgrade/route.ts`,
`app/api/auth/logout/route.ts`, `app/api/auth/handover/route.ts` (exchange
half stays where it is; only the mint half moves in).

**Data migration: none.** The `sessions` and `login_codes` tables, their
columns, and every stored `kind` value are untouched — `"guest"`,
`"agent"`, `"signup"`, `"handover"`, `"identity"` stay the internal
vocabulary forever; only the HTTP-layer translation in §2.1 is new. No
existing session, code, or link becomes invalid; a redeploy mid-flight
loses nothing live.

**v1 quirks that die with the merge, not because they were wrong but
because one door now enforces them instead of three copying them:** the
possibility of the WhatsApp-ceiling check existing on the mail-issuing
route but not (by a future edit) on a fourth kind added later; the
possibility of `destination`'s `safeDestination` check being added to one
request route and missed on a sibling; the three separate rate-limit
buckets per code kind, which under one route become one function call with
a bucket key parameterised by `for` rather than three call sites that could
drift.

## 6. Open questions

1. **Split `/keys` in two, or keep it mixed-credential?** Recommended
   default: keep it as one door (cut #5 is the weakest; see §4.5) unless
   the owner wants prefix purity enforced without exception beyond
   handover. Either way nothing about the *behaviour* changes, only the
   route count.
2. **Does `for:"write"` deserve a plainer synonym than `"write"`, given
   the product's own vocabulary already overloads "agent"?** Considered
   `"content"` (matching `SESSION_SCOPE.agent = "write:content"`) and
   `"journal-write"` (fully explicit, longer). Recommended default:
   `"write"` — it is the shortest term that is still unambiguous once
   paired with `"read"`, and it matches `SESSION_SCOPE`'s own prefix.
3. **Should the identity cookie's one-year lifetime and the guest cookie's
   one-year lifetime be shortened in v2?** Out of scope for this redesign
   — B410's reasoning (re-derive access per request, so a year-old
   identity opens only what its holder is entitled to *today*) was argued
   at length and nothing in the API reshaping here bears on it.
   Recommended default: leave `SESSION_TTL_MS` exactly as-is.
4. **Does the merged `/api/auth/codes` door need its own capability-gate
   ordering documented explicitly** (server-wide `auth`/`signup`/`mail`/
   `whatsapp` before per-journal `auth`, before address-dependent checks)
   now that four flows share one implementation? Recommended default:
   yes — write it once as a short ordered list in the route's own comment,
   since getting the order wrong is exactly what made B160 and B1552 worth
   fixing in the first place, and one door means one place that order can
   now live instead of three.
