# v2 design — Print & fulfilment

Covers: postcards (order, recipients, texts), photobooks (status readback
only — there is no agent-facing photobook write route today and this design
keeps it that way), the `fulfilmentRelay`/`fulfilmentAccept` capability pair,
address lookup, and the Gelato/Stannp print webhooks.

## 1. Inventory (v1)

### Postcards

| Route | Verb | Credential | Does |
|---|---|---|---|
| `/api/v1/[user]/postcards` | POST | agent bearer, owner only (`isOwner(user, request)`) | Proposes an order: trip+day+photo *or* inbox photo, message, from, recipients (contact ids), locale. Writes `status: draft`. Charges nothing, prints nothing. Answers a URL. |
| `/api/v1/[user]/postcards/[id]` | GET | agent bearer, owner only | Reads one order's state — trip/day/photo/message/from, recipient count, credits, `expiresAt`/`createdAt`, `sent`/`failed` counts once results exist. |
| `/api/v1/[user]/postcards/recipients` | GET | agent bearer, owner only | Who a card could go to: `contactId`, `name`, `city`, `country`, `locale`. Never a street. |
| `/api/v1/[user]/postcards/texts?trip=` | GET | agent bearer, owner only | Every day's opening line, in every locale the journal writes in — prefill material for the message. |
| `/api/helper/[user]/postcard` | POST | cookie (web helper) | The identical validation and write as the POST above, duplicated route-for-route because "a route file is not a library" (v1's own words). |
| `/[user]/postcards/[id]` (page) | GET | cookie, owner | The preview: photo, message, recipients, price, balance. |
| `/[user]/postcards/[id]/crop` | POST | cookie, owner, bearer refused outright | Adjust the photo crop on a still-`draft` order. |
| `/[user]/postcards/[id]/message` | POST | cookie, owner, bearer refused outright | Correct message/from/locale/figures-toggle on a still-`draft` order. |
| `/[user]/postcards/[id]/recipients` | POST | cookie, owner, bearer refused outright | Change who a still-`draft` order goes to, filtered against `postcardCandidates`. |
| `/[user]/postcards/[id]/send` | POST | cookie, owner, bearer refused outright | **The only thing that puts a card in the post.** Spends credits, calls the provider. |

### Photobooks

| Route | Verb | Credential | Does |
|---|---|---|---|
| `/api/v1/[user]/photobooks/[id]` | GET | agent bearer, owner only | Reads one photobook order's state — size, cover, pages, volumes, credits, files, and (once quoted) `print.contactId`/`quotedCredits`/`shipmentMethodUid`/tracking/failure. Never an address. |
| `/api/helper/[user]/photobook` | POST | cookie (web helper) | **Writes nothing.** Confirms the trip and the two named choices (size, cover) are real and hands back the URL of the owner's own maker page. |
| `/[user]/photobook/preview` | POST | cookie, owner | Plans + prices a book from live options (size, cover, locale, include-switches, per-day overrides, excluded photos). No write. |
| `/[user]/photobook/order` | POST | cookie, owner, **bearer refused outright** (`not_for_agents`) | **The one purchase call.** Claims an order id, builds the PDFs, spends credits, submits to Gelato, mails a receipt — one press, one product (build + print are not sold separately since B1425/B1157). |
| `/[user]/photobooks/[id]` (page) | GET | cookie, owner | Order status + receipt. |
| `/[user]/photobooks/[id]/[file]` | GET | cookie, owner | Downloads a built PDF. |

There is deliberately no agent-facing photobook *create*: B1428 deleted the
pre-B1157 proposal call. Planning, pricing, choosing a recipient contact and
paying are one page and one press, entirely browser-side, because the
"print portion" used to be sold separately from the build and the owner said
that made no sense.

### Fulfilment relay (`fulfilmentRelay` / `fulfilmentAccept`)

`lib/capabilities.ts:130,134` define two capability flags: `fulfilmentRelay`
(a self-hosted instance hands a finished PDF job to another Fernscout
instance that has a real printer configured) and `fulfilmentAccept` (that
instance's willingness to print somebody else's job for money — needs
`postcards`/`photobook` on a real provider *and* a configured payment
method). **Neither has a route.** `docs/plans/2026-09-06-fulfilment-relay.md`
sketched the shape; B590 (accept a relayed job) and B591 (relay a job out)
are both filed `wont-do` — the owner decided against building the chain.
B593 (admission control for the intake) is `superseded`/never needed. The
capability flags exist, resolve, and are covered by `test/capabilities.test.ts`
and `docs/testing/coverage.ts`, but gate nothing.

### Address lookup

`GET /api/address-lookup?user=&q=&locale=` — unauthenticated, rate-limited
(30/min/IP), capability-gated per journal (`addressLookup`). Proxies a
geocoding provider so the browser never holds the provider key and the
provider never sees a reader's IP. Feeds the **contact's own** address form
(where a reader types their street to ask for a real postcard) and the
owner's contacts page — never anything an agent reads. Not part of the
postcard *order* flow at all: an order is addressed by `contactId`, and this
route is how that street got onto the contact record in the first place.

### Print webhooks

`POST /api/webhooks/gelato` — unsigned provider, authenticated by a shared
custom header (`x-fernscout-webhook` == `GELATO_WEBHOOK_SECRET`, constant-time
compare, 404 with no secret configured or a bad one). Settles terminal
photobook failures (refund + mail), records tracking, mails once on first
`shipped`. Every other status is an acknowledged no-op — the order page polls
Gelato directly for anything the webhook doesn't act on. Always 200 once
authentic.

`POST /api/webhooks/stannp` — HMAC-SHA256 signed (`X-Stannp-Signature`,
constant-time compare, 404 with no secret or a bad signature). Writes only
`"cancelled"` onto one recipient's `providerStatus` on a postcard order.
Never rewrites `ok`/`sent`. Does not refund (B1532, not built). Always 200
once authentic.

## 2. v2 design

The postcard flow is the only part of this area an agent writes to. Everything
else here is either read-only for an agent, or has no agent door at all by
design (photobook purchase, the two send buttons, address lookup, the
webhooks). That asymmetry is the safety shape (rule 9) and this design keeps
it exactly, only re-housing the doors that move.

### 2.1 `PUT /api/v2/{user}/postcards/orders/{id}` — propose a postcard order

**Prefix `/api/v2`, bearer, owner-scope only** (a trip-scoped token is
refused — the same "being on the bus is not spending the journal's credits"
line v1 gives). Client-chosen id (rule 6): the agent names the order id, so a
retried propose is idempotent — `409` with the stored document, not a second
draft. This is the only genuine shape change from v1: v1's `POST` mints the
id server-side and a retried call created a second, forgotten order (nobody
has actually hit this, but it's the shape rule 6 asks for everywhere else).

Purpose: write a draft the owner can look at and correct before anything
prints. Whole document, written whole — no separate crop/message/recipients
calls from the agent side; those three remain owner-only browser doors
(§2.4) because an agent has no way to *see* a crop or a figures toggle
render, the same reasoning v1 already gives for both.

**Edit schema**

| Field | Type | Class | Notes |
|---|---|---|---|
| `source` | `{trip, day, photo}` \| `{inbox: string}` | required | Discriminated union replacing v1's four loose fields (`trip`/`day`/`photo` given together or not at all). `trip`+`day` name a published-or-draft entry (`AS_AUTHOR` reads drafts too — same as v1); `photo` is a path relative to that trip's media. `inbox` is a staged-photo id from `GET /api/v2/{user}/inbox`. Refused on a day/trip carrying `test: true` (`invalid_request`, "content nobody lived"). |
| `message` | string, 1–600 chars | required | What's printed on the back. Own words, from what the author actually told the agent — no composing. |
| `from` | string, 1–120 chars | required | The signature. |
| `recipients` | `contactId[]`, 1–25 | required | Must all appear in `GET /api/v2/{user}/postcards/recipients`; an id that doesn't is refused by name (`unknown_recipient`, lists which). Deduplicated silently — same person twice is one card. |
| `locale` | enum, `localesFor(user)` (`lib/locales.ts`) | optional | Defaults to the journal's own default locale. What language the card is written in — asserted, never inspected. |
| `crop` | `{x: 0–1, y: 0–1, zoom?: ≥1}` | optional (server-owned after) | An agent has no way to see the rendered card, so this stays optional and is realistically never sent by one — kept because it rides the same document an owner's edit door (§2.4) writes into, per rule 4 (one field, write and read, no twins). |
| `figures` | boolean | optional | Print the trip's traveller figures beside the signature. Absent means on (a trip with `travellers:` set is showing who it is); only an explicit `false` turns it off. Same "an agent can't see it, so it won't set it, but the field is shared with the owner's edit door" reasoning as `crop`. |

No `declined` map on this resource — every field above is either genuinely
required (source, message, from, recipients — refusing an order missing any
of these is refusing to guess who the card is to or what it says) or a plain
optional riding a sensible default (locale, crop, figures), which rule 2
explicitly carves out. There is nothing here worth an agent being made to
type a ten-character excuse for skipping.

**Read schema** — the edit shape plus:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Client-chosen. |
| `status` | `draft \| expired \| submitted \| built \| failed` | Server-owned. `expired` is computed at read (7-day TTL past `expiresAt`), not a stored status — same as v1. |
| `url` | absolute URL | `/{user}/postcards/{id}` — where the owner looks and presses Send. |
| `credits` | `{each, total, balance}` | `each` is frozen at propose time (never re-read from the live price), `total = each × recipients.length`, `balance` is `null` when credits are off. |
| `expiresAt`, `createdAt`, `updatedAt` | ISO instants | |
| `results` | `{contactId, ok, error?, providerStatus?}[]` | Present only once sent. `providerStatus` is Stannp's own further word (`cancelled`, from the webhook) — additive, never contradicts `ok`. No address, ever, in any of these. |

**Example**

```
PUT /api/v2/ana/postcards/orders/lisbon-marta-01
Authorization: Bearer <agent token>

{
  "source": { "trip": "portugal-2026", "day": "2026-04-03-sintra", "photo": "IMG_0231.jpg" },
  "message": "Sintra this morning — mist in the pines, the palace half-hidden. Wish you were here.",
  "from": "Ana & Léo",
  "recipients": ["marta-lisbon"]
}
```
```
201 Created
{
  "id": "lisbon-marta-01",
  "status": "draft",
  "source": { "trip": "portugal-2026", "day": "2026-04-03-sintra", "photo": "IMG_0231.jpg" },
  "message": "Sintra this morning — mist in the pines, the palace half-hidden. Wish you were here.",
  "from": "Ana & Léo",
  "recipients": ["marta-lisbon"],
  "locale": "en",
  "credits": { "each": 20, "total": 20, "balance": 480 },
  "expiresAt": "2026-09-19T14:03:00Z",
  "createdAt": "2026-09-12T14:03:00Z",
  "updatedAt": "2026-09-12T14:03:00Z",
  "url": "https://ana.fernscout.ch/ana/postcards/lisbon-marta-01",
  "next": "Nothing has been printed or charged. Ask Ana to open the URL and press Send."
}
```

**Refusals**: `missing_token`, `invalid_token`, `forbidden` (not the owner /
trip-scoped token), `postcards_disabled`, `contacts_disabled`,
`unknown_trip`, `unknown_day`, `unknown_inbox_file`, `test_content`
(new — v1 folds this into a generic 400; naming it lets an agent tell "wrong
photo" from "this day is a rehearsal" apart), `unknown_photo`,
`unknown_recipient` (details: `unknown: string[]`), `invalid_request`
(message/from empty or oversize, >25 recipients), `no_database`, 409 on a
retried id with a body that disagrees with the stored one (rule 6).

### 2.2 `GET /api/v2/{user}/postcards/orders/{id}` — read one order

Same read shape as above. Owner-scope bearer only. Refusals:
`missing_token`, `invalid_token`, `forbidden`, `postcards_disabled`,
`unknown_order`.

### 2.3 `GET /api/v2/{user}/postcards/recipients` — who a card could go to

Unchanged from v1 in substance, moved to `/api/v2`. Owner-scope bearer.
Answers `{contactId, name, city, country, locale}[]` — never a street.
`GET /api/v2/{user}/postcards/texts?trip={id}` stays alongside it, same
shape, for the same reason: prefill material, read-only, bearer.

Refusals: `postcards_disabled`, `contacts_disabled`, `forbidden`,
`unknown_trip` (texts only).

### 2.4 The owner's own doors — unchanged, re-housed under `/api/web`

`crop`, `message`, `recipients` (edit) and `send` stay exactly what v1 built
them to be: cookie-only, `isOwner()` called *without* the request so a
bearer token can never satisfy them, and a request carrying an
`Authorization` header refused outright rather than falling through
(`not_for_agents`). This is rule 9's untouchable shape — an agent proposes,
a person's browser sends — and nothing in this redesign weakens it. Only the
path prefix changes for consistency with the four-prefix rule:

- `PATCH /api/web/{user}/postcards/orders/{id}` — merges `crop`, `message`+`from`+`locale`, `figures`, or `recipients` (any subset, one door instead of three) — still refused once the order has left `draft`.
- `POST /api/web/{user}/postcards/orders/{id}/send` — the button.
- `POST /api/web/{user}/photobooks/preview`, `POST /api/web/{user}/photobooks/orders/{id}` — the one-press purchase, unchanged, still 403 outright on any `Authorization` header.

Collapsing the three owner-edit routes into one `PATCH` is the one real
simplification here (JSON Merge Patch, per rule 1's "few doors" — three POST
routes doing "change one part of the same draft" were never three different
operations, they were one operation the file system happened to split by
form). The `send` door and the photobook purchase door stay separate POSTs —
they are not edits, they are the one place money moves, and rule 9 says that
moment stays untouchable and explicit.

### 2.5 Photobook: `GET /api/v2/{user}/photobooks/orders/{id}`

Unchanged in shape from v1, moved prefix only. Owner-scope bearer. Same
fields: size, coverType, pages, volumes, credits, files, and — once quoted —
`print.contactId`/`quotedCredits`/`quotedAt`/`shipmentMethodUid`/
`providerRef`?/`failure`?/tracking. Never an address.

**No `PUT .../photobooks/orders/{id}` on the agent side.** Kept exactly as
v1 left it after B1428: there is nothing for an agent to propose, because
planning, pricing and paying for a book are one page and one press and the
owner has already said that splitting them made no sense. An agent that
wants to nudge somebody toward ordering one still gets a helper-side "here's
the maker page for this trip" — that stays outside `/api/v2` entirely
(§4, migration ledger) because it writes nothing.

Refusals: `missing_token`, `invalid_token`, `forbidden`,
`photobook_disabled`, `unknown_order`.

### 2.6 `fulfilmentRelay` / `fulfilmentAccept`

**No v2 design proposed.** Neither has a route in v1, the two tickets that
would have built one (B590, B591) are filed `wont-do`, and the admission-
control ticket that would gate the intake (B593) is `superseded`. There is
nothing to re-house. See §3 for the cut.

### 2.7 Address lookup

Stays a public, unauthenticated, capability-gated route — it has no
credential to hold because it is reached before anyone has signed in (a
guest filling in their own postal address on a contact form). It is not an
agent-facing door and was never under `/api/v1`; it belongs under
`/api/web/address-lookup` for prefix consistency (rule 13 says every route
names its prefix, and "unauthenticated browser internal" is what `/api/web`
already means elsewhere) but needs no other change: same params
(`user`, `q`, `locale`), same rate limit, same `lookup_unavailable` on a
provider failure distinguished from "no matches".

### 2.8 Webhooks

`POST /api/webhooks/gelato`, `POST /api/webhooks/stannp` — unchanged in
every particular. They already live under the right prefix, they authenticate
the provider rather than a person, and none of the document-oriented /
asked-or-declined rules apply to a provider's own event shape.

## 3. Proposed cuts

- **`fulfilmentRelay` / `fulfilmentAccept` capability flags.** Two flags that
  resolve, are tested, and gate a route that has never existed and that the
  owner decided (B590/B591, `wont-do`) not to build. Nothing renders or
  computes from them beyond `/api/health`'s capability listing. Rule 8 says
  kill an inert field; these are the closest thing this area has to one.
  **Recommend: delete the two `REQUIREMENTS` entries, their `configuredEnv`
  branch, and `fulfilmentAcceptProblem()`**, or — if the owner wants the door
  left ajar for a future instance-federation feature — leave them exactly as
  documented scaffolding and say so explicitly in `lib/capabilities.ts` rather
  than letting `/api/health` list a capability that can never do anything.
  Either is fine; leaving it silently as-is (current state) is the one option
  that fails rule 8.

- **The v1 `/api/helper/[user]/postcard` and `/api/helper/[user]/photobook`
  route-for-route duplication of the v1 write logic.** Not a v2-surface cut —
  the helper still needs a cookie-authenticated door, since the web helper
  has no bearer token of its own — but the *duplication* is worth killing.
  v1's own module comment defends it ("a route file is not a library"); v2's
  validation should not repeat that argument. See migration ledger §4.

- **`POST /api/v1/[user]/postcards` minting the order id server-side.**
  Replaced by client-chosen ids (§2.1) for the same idempotency reason every
  other v2 create call gets one. Not a capability cut, a shape cut.

- **Nothing about the postcard/photobook safety shape itself is proposed for
  cut** — the owner's own two-call pattern (propose vs. send/buy), the
  contact-id-not-address rule, and the browser-cookie-only send doors are the
  rule 9 untouchable core of this whole area and this design does not touch
  any of them.

## 4. Migration ledger

| File | Action |
|---|---|
| `app/api/v1/[user]/postcards/route.ts` | Split: validation (source resolution, message/from/recipient checks) moves to a shared `lib/postcard/validate.ts` the v2 route and the helper route both call; write half (`createOrder`) unchanged. Rewrite as `app/api/v2/[user]/postcards/orders/[id]/route.ts` `PUT`. |
| `app/api/v1/[user]/postcards/[id]/route.ts` | Rewrite as `app/api/v2/[user]/postcards/orders/[id]/route.ts` `GET`, same file as above. |
| `app/api/v1/[user]/postcards/recipients/route.ts`, `.../texts/route.ts` | Move under `/api/v2`, logic unchanged. |
| `app/api/helper/[user]/postcard/route.ts` | Rewritten to call the shared `lib/postcard/validate.ts` extracted above instead of re-typing the same four checks — this is the cut in §3, not a route-surface change (the helper keeps its own cookie-authenticated door; it stops being a second copy of the logic). |
| `app/[user]/postcards/[id]/crop/route.ts`, `.../message/route.ts`, `.../recipients/route.ts` | Merge into one `app/api/web/[user]/postcards/orders/[id]/route.ts` `PATCH`, JSON Merge Patch over whichever subset (`crop`/`message`+`from`+`locale`+`figures`/`recipients`) arrives. `where status = 'draft'` guard, and the "refuse any bearer outright" guard, carried over unchanged onto the merged handler. |
| `app/[user]/postcards/[id]/send/route.ts` | Move to `app/api/web/[user]/postcards/orders/[id]/send/route.ts`, logic unchanged. |
| `app/api/v1/[user]/photobooks/[id]/route.ts` | Rewrite as `app/api/v2/[user]/photobooks/orders/[id]/route.ts` `GET`, unchanged fields. |
| `app/api/helper/[user]/photobook/route.ts` | Unchanged in substance (still writes nothing, still hands back the maker URL); stays a `/api/web`-style cookie door since it is a helper-conversation convenience, not part of the bearer contract — call it out in the openapi doc as helper-internal, not `/api/v2`. |
| `app/[user]/photobook/preview/route.ts`, `.../order/route.ts` | Move to `/api/web/[user]/photobooks/preview`, `/api/web/[user]/photobooks/orders/[id]`. Every guard (foreign-origin check, bearer refused outright, claim-before-build-before-spend-before-print ordering, `stale_preview` re-quote) carried over unchanged — this is the highest-stakes money path in the whole area and nothing about the sequencing changes. |
| `lib/capabilities.ts` | Either delete `fulfilmentRelay`/`fulfilmentAccept` (§3) or leave as documented, intentionally-unimplemented scaffolding — owner's call. |
| `app/api/address-lookup/route.ts` | Move to `app/api/web/address-lookup/route.ts`. No logic change. |
| `app/api/webhooks/gelato/route.ts`, `.../stannp/route.ts` | Unchanged, unmoved. |
| Data migration | **None.** `print_orders` rows are read by id and owner exactly as before; v2's client-chosen id only changes how *new* rows get their id, and existing draft/submitted/built/failed rows read back through the new GET shape without transformation — every field the v2 read schema names already exists in `OrderPayload`/photobook's `payload`. |

## 5. Open questions

1. **Kill `fulfilmentRelay`/`fulfilmentAccept` outright, or leave them as
   explicit unimplemented scaffolding?** Recommend: kill them. Two `wont-do`
   tickets and a `superseded` one is about as clear a "not building this" as
   this codebase produces, and a capability flag that resolves to a reason
   string nobody can act on is the thing rule 8 exists to catch. If the owner
   expects to revisit instance-to-instance fulfilment later, a `docs/plans/`
   file (already written, `2026-09-06-fulfilment-relay.md`) is where that
   intent belongs — not a live capability check.

2. **Does the merged `PATCH .../postcards/orders/{id}` (§2.4) replace all
   three owner-edit routes, or is `send` alone worth merging in as a fourth
   verb on the same resource (`PATCH` with a `status: "sent"` field) rather
   than a separate `send` sub-route?** Recommend: keep `send` as its own
   route. Folding "print this and charge money" into the same PATCH as "fix
   a typo" is exactly the kind of universal door rule 9 warns against
   blurring — a person pressing Send should be doing something visibly
   different from a person fixing a typo, in the URL as much as in the UI.

3. **Should `GET /api/v2/{user}/postcards/orders` (a list, no id) exist?**
   v1 never built one — an agent that proposed an order already has its id
   from the 201, and the owner browses orders from their own page, which
   reads the database directly rather than through this API. Recommend: no,
   for the same reason v1 never had one; add it only if a real caller needs
   to enumerate orders it did not itself create (none does today).

4. **`test_content` as its own error code (§2.1) vs. folding it into
   `invalid_request` the way v1 does.** Recommend: name it. It is a
   different fact for an agent to act on ("compose from a different day" vs.
   "the request itself is malformed") and costs one line in
   `lib/api/errorCodes.ts`.
