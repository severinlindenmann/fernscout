# v2 area design — MONEY

Covers: credits (`lib/credits.ts`), the purchase flow (buy → mail/Stripe →
approve/webhook → grant), the operator-approval fallback, storage purchase
(5 GB blocks), usage recording (`lib/usage.ts`), and the refund/grant
mechanics behind the admin cost view. `/admin` itself and its cost-per-model
arithmetic (`lib/costs.ts`, distinct from `lib/credits/pricing.ts`) are the
web agent's area; this document only reaches into `/admin`'s two POST doors
(`grants`, `refunds`) because they are credit-ledger writes.

## 1. Inventory — every v1 route and capability

| Route | Verb | Credential | Does |
| --- | --- | --- | --- |
| `GET /api/v1/[user]/storage` | GET | bearer, any scope | usage, breakdown by trip, reclaimable-via-cleanup preview, ceiling |
| `POST /api/v1/[user]/storage` | POST | owner cookie **or** owner-scope bearer; **bearer explicitly refused (403 `not_for_agents`)** | spends `EXTRA_STORAGE_CREDITS` (50), grants +5 GB, lifetime, repeatable |
| `GET /api/v1/[user]/storage/cleanup` | GET | owner cookie only; bearer refused | dry-run: bytes reclaimable by deleting generated photobook PDFs / postcard sheets |
| `POST /api/v1/[user]/storage/cleanup` | POST | owner cookie only; bearer refused | deletes those files; no credits move, no order records touched |
| `POST /api/v1/[user]/credits/purchase` | POST | owner cookie **or** owner-scope bearer (not trip-scoped) | records a **pending** `Payment` row, mails owner an absolute link to `/<user>/payment/<id>`. Grants nothing. |
| `POST /api/v1/[user]/payments/[id]/pay` | POST | **none** — the id is the capability, mailed as a link | Stripe path: opens/reuses a Checkout Session, returns its URL. No-Stripe path: files a `method` + mints a single-use approval token, mails it to the **operator** (never the buyer). Grants nothing either way. |
| `POST /api/v1/[user]/payments/[id]/approve` | POST | **none** — a single-use token mailed to the operator | the one of two HTTP paths that actually raises a balance: claims the token atomically, `grant()`s, sends a receipt |
| `POST /api/webhooks/stripe` | POST | Stripe signature (HMAC over raw body) | the other balance-raising path: verifies signature + mode + currency, atomically claims the row, `grant()`s, sends a receipt |
| `POST /api/admin/grants` | POST | admin cookie (`isInstanceAdmin`) | files a **zero-franc** `Payment` already `requested`, mints the same approval token, mails the operator — grants nothing itself, rides the same `approve` door |
| `POST /api/admin/refunds` | POST | admin cookie | marks a `paid` row `refunded` (no Stripe call — the operator refunds the charge in Stripe's dashboard by hand), then `clawBack()`s the credits, floored at zero, mails the owner a refund notice |
| (no route) | — | — | `GET /[user]/payment/[id]` and `/approve/[token]` are pages, not API — out of scope here |
| (no route) | — | — | `recordUsage()` (`lib/usage.ts`) is called from four call sites (`helper`, `transcription`, digest sends, postcard/photobook print) and has no HTTP door at all — it is instance bookkeeping, never journal-facing |
| (no route) | — | — | `/admin` (`app/admin/page.tsx`) reads `paymentsPaidSince`, `takings`, `usage` directly as a server component — no JSON API backs it today |

Capabilities not reachable by any route, worth naming because a v2 redesign
could accidentally invent a door to them: `grant()` and the ledger tables are
never reachable by request-named amount (property 1); `spend()`/`refund()`
are called only from the five fixed `SpendReason`s, never from a route body
naming a reason.

## 2. v2 design

### 2.1 `GET /api/v2/{user}/status` (existing, decided) — what this document feeds it

`journalStatus.credits` and `journalStatus.storage` are already decided
fields on the pre-flight read. This design treats them as **the only place a
balance and a storage ceiling are ever reported to an agent as a bare
number** — nothing below repeats them; the resources below add detail
*around* those numbers (history, in-flight purchases, per-trip breakdown),
never a second copy of the number itself.

`instanceStatus.pricing` (decided, `Record<string, number>`) is populated
from this area's constants, one key per fixed-price spend:

| key | value | source |
| --- | --- | --- |
| `postcard` | `POSTCARD_CREDITS` (20) | `lib/credits/pricing.ts` |
| `storage_5gb` | `EXTRA_STORAGE_CREDITS` (50) | `lib/credits/pricing.ts` |
| `helper_photos_per_credit` | `PHOTOS_PER_CREDIT` (10) | `lib/helper/credits.ts` — inverse of a price, but it's the number a caller needs to estimate cost from a photo count |
| `credit_chf` | `BASE_RAPPEN_PER_CREDIT / 100` (0.20) | `lib/credits/pricing.ts` — the ceiling price; a bigger purchase is only ever cheaper |

`photobook` is deliberately **absent**: its price is a live Gelato quote,
not a constant, and `photobookPriceCredits()` needs page/size/cover inputs
`instanceStatus` has no room for. An agent asks the photobook door for a
quote instead (that door is not this area's).

### 2.2 Purchases — `POST /api/v2/{user}/purchases`, `POST /api/web/{user}/purchases`, `GET .../purchases[/{id}]`

**Purpose.** Propose buying credits. Writes a `pending` transaction and
mails the owner an absolute link. **This resource never grants a credit** —
the same property v1 holds, restated so a client cannot misread the 2xx as
money landing.

Two create doors, one shared implementation (`createPurchase()`), split by
credential exactly the way v1's `isOwner()` already accepted both and the
v2 four-prefix rule now makes explicit:

- `POST /api/v2/{user}/purchases/{id}` — bearer, **owner-scope token only**
  (a trip-scoped token is `out_of_scope`). This is for the case the current
  docstring already names: an agent chatting with the owner proposes a top-up
  and hands them the `paymentUrl` to open. It moves no money and mails
  nobody but the owner, so letting an agent trigger it is safe — the same
  reasoning that keeps it off storage purchase does not apply here (see 2.3).
- `POST /api/web/{user}/purchases/{id}` — owner cookie only. The account
  page's own "buy credits" slider.

**Client-chosen id (core rule 6).** v1 minted `newId()` server-side; v2 asks
the caller for one, `PUT`-shaped semantics on `POST` (create-if-absent):

- Same id, same `credits` → 200 with the stored document, no new mail sent.
  This is what "409 semantics with a payment in flight" resolves to in
  practice: a network retry after a mail already went out must not send a
  second mail or open a second checkout row, and a client-chosen id is what
  makes that a no-op instead of a duplicate.
- Same id, **different** `credits` → 409, body is the stored document. The
  id was already spent on a different amount; choose a new one.
- No cap on **distinct** ids in flight per journal — a second, independent
  `POST /purchases/top-up-2` while `top-up-1` is still `pending` succeeds.
  v1 already allows this (nothing in `createPayment` checks for an existing
  pending row) and there is a legitimate case for it: somebody starts a
  purchase, changes their mind about the amount, and starts a second one
  without the first blocking them. See Open Questions for the alternative.

**Edit schema**

| Field | Type | Class | Notes |
| --- | --- | --- | --- |
| `credits` | integer | required | `MIN_CREDITS`–`MAX_CREDITS` (10–500), step `CREDIT_STEP` (10) — `lib/credits/pricing.ts`. An amount, never a price; the price is always server-computed from it (`priceRappen`). |

Nothing else is writable. There is no `declined` map on this resource — it
has one required field and no optional detail, so core rule 2's "plain
optional only where absent is the overwhelming default" carve-out applies
to the whole document rather than to individual fields.

**Read schema** (edit shape plus server-owned rows)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | client-chosen |
| `credits` | integer | as written |
| `priceRappen` | integer | `priceRappen(credits)`, server-owned |
| `price` | string | `formatChf(priceRappen)`, e.g. `"CHF 18.80"` |
| `discount` | string | `discountLabel(credits)`, e.g. `"6%"` |
| `status` | enum | `pending` \| `requested` \| `paid` \| `refunded` — `PaymentStatus`, `lib/payments.ts` |
| `method` | enum \| null | `twint` \| `card` — `PaymentMethod` minus `admin`, which never appears on a purchase this door created |
| `paymentUrl` | string \| null | absolute, present while `pending`/`requested`; null once `paid`/`refunded` — there is nothing left to open |
| `mailedTo` | string | the owner's address the purchase-inquiry mail went to |
| `createdAt` / `requestedAt` / `paidAt` | ISO instant \| null | as `Payment` already carries |

**Example**

```
POST /api/v2/anaïs/purchases/top-up-2026-09
Authorization: Bearer fs_agent_...
{ "credits": 100 }

201
{
  "id": "top-up-2026-09",
  "credits": 100,
  "priceRappen": 1880,
  "price": "CHF 18.80",
  "discount": "6%",
  "status": "pending",
  "method": null,
  "paymentUrl": "https://anais.fernscout.ch/anais/payment/top-up-2026-09",
  "mailedTo": "anais@example.com",
  "createdAt": "2026-09-12T09:14:02Z",
  "requestedAt": null,
  "paidAt": null
}
```

The echo is the truthful report core rule 10 asks for: it says a mail is
waiting and hands over the link, never "credits added" — the same sentence
AGENTS.md requires of the agent that relays this to a person.

**Reading the list — can an agent read the journal's ledger?**

`GET /api/v2/{user}/purchases` and `GET /api/v2/{user}/purchases/{id}` —
bearer, **owner-scope only** (trip-scoped: `forbidden`). Yes, with that one
restriction: an owner-scope agent token already sees the balance on
`journalStatus`, and seeing *how it got there* is the same class of fact.
A trip-scoped token sees neither — a trip credential answers for one trip's
content, not the owner's whole financial history.

### 2.3 The credit ledger — `GET /api/v2/{user}/credits/ledger`

**Purpose.** The append-only spend/grant/refund trail (`credit_ledger`,
read via `ledgerFor()`), separate from `purchases` above: a purchase is one
attempt to add credits, the ledger is every delta on the balance — sends,
model calls, storage buys, grants, refunds. v1 has no HTTP door for this at
all (`npm run credits -- list` is CLI-only); this is new surface, not a
migration.

Bearer, owner-scope only, same reasoning as 2.2. Read-only — there is no
write shape, because nothing in this document can produce a ledger row; it
is derived entirely from `spend`/`grant`/`refund`/`clawBack` elsewhere.

**Read schema**

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | ledger row id |
| `delta` | number | credits, signed; hundredths since B987 |
| `reason` | enum | `LedgerReason` — `grant`, `day_mail`, `day_whatsapp`, `digest`, `postcard`, `photobook`, `photobook_print`, `storage`, `helper`, `transcription`, `ask_thread`, `find_in_journal`, `travellers_from_photo`, `refund`, `purchase_refund` — `lib/credits.ts:LedgerReason` |
| `ref` | string \| null | what the spend was for (a day slug, a payment id, …) |
| `note` | string \| null | operator's free text on a grant |
| `createdAt` | ISO instant | |

Paginated — `?before=<id>&limit=` mirroring the shape other v2 list reads
use; `ledgerFor()` already takes a `limit`.

**Refusals for 2.2 and 2.3:** `out_of_scope` (trip-scoped token),
`no_such_journal`, `unknown_payment` (single-purchase GET, wrong id or
another journal's), `invalid_amount` (purchase create, off the
tier/range/step), `conflict` (409, purchase id reused with a different
amount), `credits_disabled` (`creditsEnabled()` false — the whole area 404s,
matching v1), `too_many_requests`.

### 2.4 Paying — `POST /api/web/{user}/purchases/{id}/pay`

**Purpose.** "Pay now" on the payment page. Unchanged in shape from v1:
credential is **none** — the purchase id, mailed as an unguessable link, is
the whole capability, the same pattern the delete-confirmation and handover
links already use. It stays outside `/api/v2` because it is not part of the
agent contract; it stays a `/api/web` door because it is a page a browser
opens, even though (deliberately) it needs no cookie to do so — the id
already proves the right person is holding it.

Two branches, unchanged from v1 and worth keeping exactly as-is (this is a
safety shape, core rule 9's "untouchable" applies to the two-step grant
regardless of which door reaches it):

- **Stripe configured**: opens/reuses a Checkout Session, returns its `url`.
  Grants nothing; the webhook does.
- **No Stripe**: takes `method` (`twint`|`card`, never `admin`), mints a
  single-use token, mails it to the **operator**, never the buyer. Grants
  nothing; `.../approve` does.

**Edit schema**

| Field | Type | Class | Notes |
| --- | --- | --- | --- |
| `method` | enum | conditional | required and validated (`twint`\|`card`) only when Stripe is **not** configured; refused (`unsupported_field`) when it is, since Stripe's own page is where the choice happens |

**Read schema**

| Field | Type | Notes |
| --- | --- | --- |
| `status` | `"requested"` | always, on success |
| `url` | string \| null | the Stripe Checkout URL (Stripe path) |
| `approver` | string \| null | the operator's address the approval mail went to (no-Stripe path) — never the buyer's own, so the response cannot be misread as "you approved this" |
| `creditsAdded` | `0` | always — literal, so a client cannot infer anything from a nonzero value that will never appear |

Refusals: `unknown_payment` (bad id, foreign id, already `paid`),
`bad_method`, `provider_unavailable` (502, Stripe outage — nothing charged,
retry), `too_many_requests`.

### 2.5 Approving — `POST /api/web/{user}/purchases/{id}/approve/{token}`

**Purpose.** The operator's mailed link, opened once. Unchanged from v1 in
every load-bearing way — this is the safety mechanism core rule 9 protects:
credential is the token alone (never a session), the claim is one atomic
conditional UPDATE so the token is spendable exactly once, and `grant()` is
called from **this file only** among the v2 routes (plus the webhook —
`GRANT_ALLOWED` in `test/credits.test.ts` still names exactly these two
plus `journals`/WhatsApp-signup).

**Edit schema:** none — the token in the URL is the whole input. (v1 also
sent `token` in the body; folding it into the path is a cosmetic
simplification, not a behaviour change — the token is still checked, still
single-use.)

**Read schema**

| Field | Type | Notes |
| --- | --- | --- |
| `status` | `"paid"` | |
| `creditsGranted` | integer | the one number this door is allowed to report as landed, because it just did land it |

Refusals: `unknown_payment` (bad id/journal), `link_spent` (wrong or
already-used token — v1 answered a bare `403` with the raw claim reason;
v2 maps every non-`unknown` claim failure to the published `link_spent`
code, which already has a documented sentence, rather than inventing
`bad_token` alongside it).

### 2.6 Storage — `GET /api/v2/{user}/storage`, `POST /api/web/{user}/storage/purchases`, cleanup

**`GET /api/v2/{user}/storage`** — bearer, any scope. Purpose: the detail
`journalStatus.storage` (decided: `usedBytes`, `maxBytes`) doesn't carry —
per-trip breakdown and what cleanup could reclaim, so an agent hitting a
full journal can say something useful before proposing a purchase or a
cleanup rather than just "it's full."

Read-only.

| Field | Type | Notes |
| --- | --- | --- |
| `usedBytes` / `limitBytes` / `purchasedBytes` / `remainingBytes` | integer / null | `StorageUsage` — repeats `journalStatus.storage`'s two fields plus the two only this door needs; not a second source, same `storageFor()` call |
| `breakdown` | array of `{key, label, bytes}` | one row per trip, inbox, generated output, `other` — `storageBreakdown()`, zero-byte rows dropped |
| `reclaimable` | object | `cleanupPlan()` — bytes/files cleanup would free, without deleting anything |
| `extension` | `{credits, addsBytes}` | `EXTRA_STORAGE_CREDITS`, `EXTRA_STORAGE_BYTES` — what buying more costs, so an agent can quote it without a second lookup |

**`POST /api/web/{user}/storage/purchases`** — owner cookie **only**.
Bearer is refused outright, `403 not_for_agents`, unchanged from v1 and
deliberately kept: this door *spends* the owner's existing balance
immediately, for disk rather than for reaching anyone — the one spend in
the whole area that "buys the journal something" rather than a delivery.
An agent that hits a full journal reports it and stops; deciding to spend
real credits on more room is the owner's, from their own page, not an
agent's to trigger even on instruction, because the instruction has no way
to be verified as informed consent the way "yes, publish" does.

Client-chosen id here too, same 409-on-mismatch shape as purchases — a
purchase-of-storage is `EXTRA_STORAGE_BYTES` for `EXTRA_STORAGE_CREDITS`,
fixed, so a retried create with the same id is a no-op re-read rather than
a second spend.

**Edit schema:** none — the amount is fixed, so there is nothing to send
beyond the id in the URL.

**Read schema:** `credits` (50), `addedBytes`, `usedBytes`, `limitBytes`,
`purchasedBytes` (post-purchase), `message` (the human sentence v1 already
composes).

Refusals: `not_for_agents` (403, any `Authorization` header present),
`forbidden` (cookie present but not owner), `no_credits` (402, balance
short or no database), `credits_disabled`, `too_many_requests`.

**`GET/POST /api/web/{user}/storage/cleanup`** — owner cookie only, bearer
refused, unchanged from v1: GET is the plan, POST executes it. No credits
move either direction; kept as-is because it is already minimal (delete
regenerable PDFs, keep every order record).

### 2.7 The operator's two doors — `/api/admin/grants`, `/api/admin/refunds`

Not renamed here in substance — they stay admin-cookie-gated,
`isInstanceAdmin()`-only, `404` to everyone else. Under the new four-prefix
scheme they are cookie-only browser internals and move to
`/api/web/admin/grants` and `/api/web/admin/refunds` for the same reason
`/admin` itself does (the web agent's call to place exactly). Semantics
unchanged:

- **`grants`**: files a zero-franc `Payment`, already `requested`, mints
  the same approval token, mails the operator. Grants nothing itself — rides
  `.../approve` (2.5), so `GRANT_ALLOWED` does not widen.
- **`refunds`**: acts immediately (no mailed confirmation — see its
  docstring's asymmetry argument: it only ever *lowers* a balance, so the
  mailed-link protection a grant needs would protect nothing here). Marks
  the row `refunded`, calls `clawBack()` (floored at zero — a journal that
  already spent the credits does not go negative), mails the *owner* (not
  the operator) a refund notice, reports `creditsTaken` and any `shortfall`
  honestly rather than pretending the full amount always comes back.

## 3. Proposed cuts

**`amountRappen` as a raw number on the read shape — replace with `price`
(formatted) only.** v1's `Payment.amountRappen` is Swiss rappen with no unit
in the field name; every caller that shows it to a person already formats
it through `formatChf`. Keep the formatted string on the wire, drop the
raw minor-unit integer — nothing outside `lib/payments.ts`/`lib/stripe.ts`
needs to do arithmetic on it, and a bare integer invites a client to
mis-render it in the wrong currency or unit. *Replaces with:* `price`
(string) as specced in 2.2. Owner's call — if a future reconciliation
feature wants the raw rappen back, it's one field to re-add.

**Fold `payments/[id]/pay`'s `token` body-param into the URL path
(2.5).** Cosmetic; argued above. Nothing lost, nothing gained but one field
off the request body.

**No v2 door for `npm run credits -- audit` (`auditOwner`).** It compares
the stored balance against the ledger sum to catch a bug in this module,
not a fact about a journal a caller would ever ask for. Nothing changes:
stays CLI-only.

**`method: "admin"` never reaches a read shape.** It exists on `Payment`
purely so admin grants can reuse the approval machinery; excluding it from
the `purchases` read enum (2.2) rather than documenting it as a possible
value a normal buyer could see is deliberate — a buyer's purchase can never
carry it, and an admin grant is never listed under `GET .../purchases`
(2.2's list is owner-facing purchases the owner *asked for*; an admin grant
is not one — see Open Questions on whether it should appear anywhere at
all to the owner).

**Nothing else.** Every other v1 capability in this area (storage cleanup,
the two-branch pay door, the operator-approval fallback, the Stripe
webhook, refunds) earns its keep and is carried forward essentially as-is —
this is one of the areas where v1 was already careful rather than
accumulating cruft, because `test/credits.test.ts`'s `GRANT_ALLOWED`
allowlist has been enforcing the one property that matters here since B366.

## 4. Migration ledger

| v1 file | v2 treatment |
| --- | --- |
| `app/api/v1/[user]/credits/purchase/route.ts` | split into `app/api/v2/[user]/purchases/[id]/route.ts` (bearer) and `app/api/web/[user]/purchases/[id]/route.ts` (cookie), both calling a new shared `createPurchase(user, id, credits)` in `lib/payments.ts` — the validation/mail half is unchanged, only the id and the door split are new |
| `app/api/v1/[user]/payments/[id]/pay/route.ts` | moves to `app/api/web/[user]/purchases/[id]/pay/route.ts`, logic unchanged |
| `app/api/v1/[user]/payments/[id]/approve/route.ts` | moves to `app/api/web/[user]/purchases/[id]/approve/[token]/route.ts`; body's `token` becomes a path segment, `claimApproval` signature unchanged |
| `app/api/v1/[user]/storage/route.ts` | GET half becomes `app/api/v2/[user]/storage/route.ts` (bearer, widened detail per 2.6); POST half becomes `app/api/web/[user]/storage/purchases/[id]/route.ts` (owner cookie, client-chosen id added) |
| `app/api/v1/[user]/storage/cleanup/route.ts` | moves to `app/api/web/[user]/storage/cleanup/route.ts`, unchanged |
| `app/api/webhooks/stripe/route.ts` | unchanged, stays at this exact path — Stripe calls it, the prefix is already right |
| `app/api/admin/grants/route.ts`, `app/api/admin/refunds/route.ts` | move to `app/api/web/admin/grants`, `app/api/web/admin/refunds`; logic unchanged |
| `lib/payments.ts` | add `createPurchase(owner, id, credits)` (client-id create-or-409, replacing `createPayment`'s `newId()`); every other exported function (`submitRequest`, `claimApproval`, `claimProviderPayment`, `refundPayment`, `createAdminGrant`, `paymentsAwaiting`, `paymentsPaidSince`, `takings`) is unchanged — they already take/return ids, not doors |
| `lib/credits.ts` | add one new read, `ledgerFor()`'s existing signature already serves `GET .../credits/ledger` (2.3) directly — no change needed, just a new caller |
| `lib/credits/pricing.ts`, `lib/storageQuota.ts`, `lib/usage.ts` | unchanged; this design only adds callers |

**Data migration:** none. `payments`, `credits`, `credit_ledger` and
`usage` keep their current schemas; the only new thing v2 asks the *client*
to supply is an id on create, which the `payments` table's existing `id`
column already accepts as any string (currently always `newId()`-shaped;
nothing enforces that shape today, so client-chosen ids need no migration,
only a uniqueness-per-owner check if the owner's call in Open Questions
below goes that way instead of global uniqueness).

**v1 quirks that die:**
- The 403-with-no-code-name mismatch on `.../approve`'s `claim.reason` —
  v1 answers `{error: claim.reason}` where `claim.reason` can be
  `bad_token` or a few others not otherwise in `ERROR_CODES`; v2 maps every
  case to the one published `link_spent` code (2.5).
- `payments/[id]/pay`'s silent acceptance of an unrecognised `method` when
  Stripe is enabled (it is simply ignored, not validated) becomes an
  explicit `unsupported_field` refusal when a client sends `method` while
  Stripe is configured (2.4) — silent-drop is exactly what core rule 2 exists
  to remove.

## 5. Open questions

1. **One in-flight purchase per journal, or many?** This design keeps v1's
   behaviour (unlimited concurrent `pending`/`requested` rows). The
   alternative — refuse a second `POST .../purchases` while one is still
   open, `409` with the existing one's id — is simpler to reason about for
   an owner looking at their history, but means an owner who wants to
   change their mind about the amount has to cancel (there is no cancel
   door today) rather than just start a fresh id. *Recommend*: keep
   multiple allowed, as now; add a cancel door only if this turns out to
   confuse people in practice.

2. **Does an admin grant ever appear to the owner?** Today `createAdminGrant`
   files a row indistinguishable in shape from a real purchase except
   `method: "admin"` and `amountRappen: 0`, and it is excluded from
   `takings()` but not from `listPayments()` — so it already shows up in
   the account page's own transaction history today, as a free line. v2's
   `GET .../purchases` (2.2) would do the same unless explicitly filtered.
   *Recommend*: show it — an owner who was given free credits should be
   able to see that on their own statement — but keep `method: "admin"` off
   the *buyer-facing* method enum this document specced (2.2's table already
   does this) so a client cannot construct one.

3. **Ledger pagination cursor shape.** 2.3 sketches `?before=<id>&limit=`
   matching other v2 list reads' convention; the exact cursor field name is
   the core schema's call once list-pagination is settled there, not this
   document's to invent independently.

4. **`GET /api/v2/{user}/storage` for a trip-scoped token — full detail or
   just the two numbers already on `journalStatus`?** This design gives it
   the full breakdown (per-trip byte counts reveal a little about trips the
   token cannot see). *Recommend*: narrow the `breakdown` array to the
   token's own trip plus an `other` catch-all when the token is trip-scoped,
   rather than refusing the whole door — a trip-scoped agent still
   legitimately needs to know the journal is full before it uploads.
