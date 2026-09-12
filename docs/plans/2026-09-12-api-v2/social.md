# v2 area design — Social & Sharing

Covers: invite links (guest, buddy), the contacts queue (ask/confirm/manage/
redeem/request/self/admin), day sending (mail, WhatsApp), journal channels,
reactions.

The single fact that reshapes this whole area: **the decided core already
made `trip.people` the primary road onto a trip.** Writing a name and email
into a trip's `people` array (`lib/api/v2/schemas/trip.ts`) gives that person
write access immediately — no queue, no click — and the server mails them
(`notifications[]` in the echo: `trip-added` for an address this journal
already knows, `journal-invite` for one it does not). A buddy *link* is now
the fallback for the one case `people` cannot cover: the owner does not have
an address to type yet, or wants one forwardable object (a QR code, a family
chat message) rather than typing everyone in by hand. Below, I keep that
distinction sharp rather than let the two mechanisms blur.

## 1. Inventory — every v1 route and capability

| Route | Verb | What it does | Who calls it |
|---|---|---|---|
| `/api/v1/{user}/invites` | GET | List every invite link this journal has issued (no token) | Owner (cookie or bearer) |
| `/api/v1/{user}/invites` | POST | Create a guest or buddy link; optionally mail it to a named address (pre-approves that address) | Owner |
| `/api/v1/{user}/invites/{id}` | DELETE | Revoke one link | Owner |
| `/api/contacts/request` | POST | Personal-link (`/{user}/i/<token>`) guestbook form: name, email, optional address/phone/digest | Anonymous, with a live personal-invite token |
| `/api/contacts/redeem` | POST | Guest or buddy link redemption: proves an address (session or code), writes a `pending` contact, and for buddy also a `pending` trip-people row | Anonymous / signed-in reader |
| `/api/contacts/confirm` | POST | Second half of the six-digit code: confirms the address, and — if pre-approved (B319) — approves it outright | Anonymous with a code |
| `/api/contacts/ask` | POST | A signed-in reader who just hit a locked trip asks to be let in (name only; address off the session) | Signed-in reader |
| `/api/contacts/self` | POST | A person already in a trip's `people:` (so already has write access) registers/confirms their own contact row | Signed-in traveller |
| `/api/contacts/manage` | GET/POST | Self-serve page behind a per-row token: view, edit, unsubscribe, delete | Anyone holding the manage token |
| `/api/contacts/admin` | GET/POST | The owner's whole panel: list contacts + invites (with recoverable links), approve, revoke, delete, resend, create (owner types an address), update, self (add-owner-as-contact) | Owner only |
| `/api/v1/{user}/contacts/import` | POST | File agreed vCard rows as `pending` contacts (own confirmation mail each, never pre-approved) | Owner (agent) |
| `/api/helper/{user}/contacts/add-me` | POST | Helper's own door onto `addSelfContact` | Owner via helper (cookie) |
| `/api/helper/{user}/contacts/import` | POST | Helper's own door onto `importContactRows`, reading a card's ticked rows | Owner via helper (cookie) |
| `/api/v1/{user}/trips/{trip}/days/{slug}/send-mail` | POST | Resend the day letter to everyone opted in, unconditionally | Owner only (agent) |
| `/api/v1/{user}/trips/{trip}/days/{slug}/send-whatsapp` | POST | Resend the day's WhatsApp announcement, unconditionally | Owner only (agent) |
| `/api/v1/{user}/channels` | POST | Mute/unmute mail or WhatsApp for this journal, under the server's own ceiling | Owner (cookie or bearer) |
| `/api/helper/{user}/channels` | POST | Helper's own door onto the same `setJournalFeatures` | Owner via helper (cookie) |
| `/api/reactions` | GET/POST | Emoji reactions on a published day: counts, plus one browser's own votes by `voter` id in `localStorage` | Any reader (anonymous by design) |

Not in the brief's scope by name but touched by the same code and worth
noting: `POST /api/v1/{user}/postcards/recipients` reads contacts (out of
scope here — postcards own area); `PATCH /api/v1/{user}/config` writes
`features.whatsapp.templates` (also out of scope — journal config).

Capabilities gating this area: `contacts`, `mail`, `whatsapp`, `reactions`
(`lib/capabilities.ts`, `isEnabled`).

## 2. v2 design

### 2.1 Buddies — trip.people (already decided, referenced not redesigned)

Nothing to add here beyond what `trip.ts` already carries. One clarification
this area's design depends on: when the server mails a `journal-invite` for
an address it does not know, that mail **is** a buddy invite under the hood —
see §2.2's `AUTO` note. There is no second, separate "onboarding" mechanism;
building one would be two ways to invite a stranger onto a trip, which is
exactly the kind of duplication rule 8 asks to kill.

### 2.2 Invites — `/api/v2/{user}/invites`

**Purpose.** A forwardable link that lets somebody *ask* to join — never a
grant. Two kinds, at one door: `guest` (journal-wide reading) and `buddy`
(one named trip, write access once approved). Exists for exactly the case
`trip.people` cannot serve: the owner does not have an address in hand yet,
or wants one object to forward to a group rather than typing everyone by
name.

**URL / verbs / prefix / credential**
- `GET /api/v2/{user}/invites` — bearer, owner-scope only (never trip-scoped: an invite is a decision about who gets to *ask*, not about a trip's own days).
- `POST /api/v2/{user}/invites` — same.
- `DELETE /api/v2/{user}/invites/{id}` — same.

**Write schema**

| Field | Type | Class | Notes |
|---|---|---|---|
| `id` | string | required | Client-chosen (rule 6). Retried create → 409 with the stored invite. |
| `kind` | `"guest" \| "buddy"` | required | `personal` retired — see cuts. |
| `trip` | trip id | conditional | Required when `kind: "buddy"`; refused when `kind: "guest"` (a guest link is journal-wide — B41's rule, unchanged). |
| `email` | string (email) | optional | The owner vouching for an address: mails the link and pre-approves that exact address on confirmation (B319, unchanged). Absent = a link to copy and hand over another way. |
| `name` | string | optional | Prefill for the recipient's own form. |
| `locale` | string | optional | Which installed locale the mail and landing page use; falls back to the journal's default. |
| `expiresAt` | ISO instant | optional | Absent = 30 days (server default). Always dated — never `null`; a link that never expires is the shared password again, wearing a URL. |

**Read schema** — the write shape, plus:
- `createdAt`, `revokedAt` (nullable), `uses` (count) — server-owned.
- `url` — **present once, only in the create response.** Only the hash of the
  token is stored; a lost link is reissued, not recovered — except the
  owner's own read of `GET /api/v2/{user}/invites` recovers it from the
  reversible cipher when `CONTACTS_ENCRYPTION_KEY` is configured
  (`listInvitesWithLinks`, unchanged from v1). `GET` never returns `url` to
  anything but the owner's bearer/cookie for exactly this reason; there is no
  narrower agent-facing list that omits it, because omitting it is already
  what `GET` here does for everyone.

**Example**

```
POST /api/v2/{user}/invites
{ "id": "inv-vietnam-buddies", "kind": "buddy", "trip": "vietnam-2026" }

201
{
  "id": "inv-vietnam-buddies", "kind": "buddy", "trip": "vietnam-2026",
  "createdAt": "2026-09-12T09:00:00Z", "expiresAt": "2026-10-12T09:00:00Z",
  "revokedAt": null, "uses": 0,
  "url": "https://fernscout.ch/mira/invite/buddy/fs_inv_9jK…"
}
```

**Refusals**: `unauthorised` (not the owner) → `forbidden`; `contacts_disabled`;
`unknown_trip` (buddy kind, no such trip); `invalid_request` (buddy with no
`trip`, guest with a `trip`, malformed `email`); `409` on a retried `id`.

### 2.3 Contacts — the queue, owner side. `/api/v2/{user}/contacts`

**Purpose.** The safety shape this whole area rests on:
**`approveContact` is still the only thing in the codebase that writes an
`access_grants` row**, and this design does not touch that — it re-houses it
behind one clean door. A contact is `pending` (asked, maybe confirmed) or
`active` (the owner said yes) or `blocked` (the owner said no, reversibly).

**URL / verbs / prefix / credential** — bearer, owner-scope only, never
trip-scoped (a trip-scoped token cannot see the address book — B340's
reasoning: writing days is not deciding who reads the journal).
- `GET /api/v2/{user}/contacts` — the whole list.
- `GET /api/v2/{user}/contacts/{id}`
- `PATCH /api/v2/{user}/contacts/{id}` — owner corrections: `name`, `locale`,
  `address`, the three consent booleans, `email` (which, per v1, knocks an
  already-active row back to `pending` and clears its grants — an address
  change is a new address, and a new address has proved nothing yet).
- `POST /api/v2/{user}/contacts` — the owner adds somebody by hand (mails
  them a pre-approved invite).
- `DELETE /api/v2/{user}/contacts/{id}`

**Why status transitions stay their own verbs, not a PATCH on `status`.**
Rule 1 is "few doors, no per-field routes" — but `status` is not a plain
field here, it is the safety shape itself. A `PATCH {status: "active"}` would
let the strict-shape door become a second way to call `approveContact`,
unreviewed by anything that knows it must check `confirmedAt` and must fan
out to `approveTripPlaces`. So these stay explicit actions:
- `POST /api/v2/{user}/contacts/{id}/approve` — refuses `409 not_confirmed`
  on an address that has not proved itself. Echoes `tripsOpened: []` — the
  trip ids any pending buddy-link requests just opened, named so the owner
  sees what one click actually did (B244).
- `POST /api/v2/{user}/contacts/{id}/revoke` — reversible (B213): approving
  again restores both the journal grant and every trip place.
- `POST /api/v2/{user}/contacts/{id}/resend` — re-mail the pending invite
  this row is still waiting on (rate-limited per contact, unchanged from v1).

**Edit schema (`POST` create, and the writable subset of `PATCH`)**

| Field | Type | Class | Notes |
|---|---|---|---|
| `name` | string | required (create) / optional (patch) | Max 120 chars. |
| `email` | email | required (create) / optional (patch) | Case-folded at rest. Changing it on an active row demotes to `pending`. |
| `locale` | installed locale | optional | Falls back to the journal's default. |
| `address` | object or `null` | optional | `PostalAddress` shape (out of this area's scope in detail — see media/postcards area). `null` clears; absent leaves untouched. |
| `wantsEmailDigest` | boolean | optional | |
| `wantsPostcard` | boolean | optional | Refused (`invalid_address`) if `true` and the address is not postable. |
| `wantsWhatsapp` | boolean | optional | Refused (`invalid_phone`) if `true` and the number is not messageable. |

**Read schema** — the above, plus server-owned:
`id`, `status` (`"pending" | "active" | "blocked"`), `hasPostalAddress`,
`createdVia` (`"invite:<id>" | "self:traveller" | "owner-self" | "owner"`),
`createdAt`, `confirmedAt`, `approvedAt`, `lastSeenAt`,
`relationship` (`"reader" | "traveller" | "both" | null` — B630, unchanged
from v1's owner panel), `pendingTrips` (trip ids this contact has asked to
join and nobody has opened yet — v1's `pendingTripRequestsFor`, currently
only on the owner *page*, not the API; promoted here so an agent asking "who
is waiting" gets the same answer a person sees).

**Example**

```
POST /api/v2/{user}/contacts/{id}/approve

200
{
  "ok": true,
  "contact": { "id": "c_8f2", "status": "active", "email": "leo@example.com", … },
  "tripsOpened": ["vietnam-2026"]
}
```

**Refusals**: `forbidden`; `contacts_disabled`; `unknown_contact` (404);
`not_confirmed` (409, on `approve`); `invalid_address` / `invalid_phone`
(400); `too_many_requests` (429, on `resend`); `contact_exists` (409, on
create with a known email); `self_authored` (409 — a row `POST
/contacts/self` wrote, which the owner may see, approve, revoke or delete but
not silently rewrite — B1395, unchanged).

### 2.4 Contacts — the public/reader side. `/api/web/{user}/contacts/*`

These never take a bearer token — not because they are weaker, but because
there is no agent on this side of the door: the person is a reader nobody
runs an agent for, proving an address in their own browser. Cookie-only
fits, but "cookie" here also covers the moment *before* one exists (the
signed-in-by-code step that mints it). Same shape as v1, re-housed under one
prefix, with the routes collapsed where they were doing the same thing under
two names:

- `POST /api/web/{user}/contacts/ask` — a signed-in reader who just met a
  locked trip asks to be let in. Name only; address off the session.
- `POST /api/web/{user}/contacts/redeem` — the guest/buddy landing page.
  Unifies v1's `redeem` (session or code) and — since `personal` is retired
  as a distinct kind (§4) — the old `request` guestbook form, which did the
  identical thing behind a different URL and a different token shape. One
  door, one validation path, instead of two that could (and did, historically)
  drift.
- `POST /api/web/{user}/contacts/confirm` — the six-digit code's second half.
- `GET/PATCH/DELETE /api/web/{user}/contacts/manage` — the self-serve page,
  keyed on `?token=`, not on a session. `DELETE` is the GDPR/DSG erase.
- `POST /api/web/{user}/contacts/self` — a person already in a trip's
  `people:` registers or reconfirms their own row. **Still needed after
  `trip.people`'s auto-mail**, because that mail only fires at the moment the
  trip is written — a person added before contacts was ever switched on, or
  whose mail bounced, still needs a way to self-register once they are
  already, silently, a traveller with write access.

The helper's own doors (`/api/helper/{user}/contacts/add-me`,
`/api/helper/{user}/contacts/import`) already call the same library
functions as `POST /api/web/{user}/contacts/self` (via `addSelfContact`) and
`POST /api/v2/{user}/contacts/import` — see §4, cut them rather than keep
three copies of one action.

`POST /api/v2/{user}/contacts/import` stays under `/api/v2` (bearer,
owner-scope) — filing agreed vCard rows is exactly agent work: a person told
an agent "these are real," and the agent files them. Each row still lands
`pending`, with its own confirmation mail, never pre-approved (unchanged
safety property — importing twenty rows must not be a way past the one proof
every other contact needs).

### 2.5 Day sending — `/api/v2/{user}/trips/{trip}/days/{slug}/send`

**Purpose.** Resend an already-published day's letter and/or WhatsApp
announcement to everyone currently opted in. Owner only — a trip-scoped
token may write days into a trip and must not be able to mail or message the
journal's whole readership (B28's reasoning, restated once for both
channels rather than twice).

One door replaces two identical routes (`send-mail`, `send-whatsapp`): the
only thing that differed between them was which array of recipients
`sendDayLetter`/`sendDayWhatsapp` walked, and a caller wanting both today
makes two round trips for one intention ("tell people about this day
again").

**URL / verb / prefix / credential**: `POST
/api/v2/{user}/trips/{trip}/days/{slug}/send` — bearer, owner-scope only.

**Edit schema**

| Field | Type | Class | Notes |
|---|---|---|---|
| `channels` | array of `"mail" \| "whatsapp"` | required | At least one. Each is checked against this journal's own channel switches (§2.6) and the server's capability before anything sends. |

**Read schema (the response — this is an action, not a document; still
shaped for one fact, one address)**

```
{
  "ok": true,
  "resend": true,
  "results": {
    "mail":     { "attempted": true, "sent": 41, "failed": 0 },
    "whatsapp": { "attempted": true, "sent": 12, "failed": 1,
                  "errors": [{ "to": "…4471", "error": "template_rejected" }] }
  }
}
```

Never addresses or full phone numbers — counts, and a masked last-four for a
WhatsApp failure (unchanged from v1's `whatsappSummary`). A channel not
requested is simply absent from `results`, not reported as skipped — the
caller asked for what it asked for.

**Refusals**: `forbidden` (trip-scoped token); `unknown_trip`; `unknown_day`;
`not_published` (409 — publish first); `test_content` (400 — `test: true`
sends nothing, ever); `mail_disabled` / `whatsapp_disabled` (per-channel,
inside `results` rather than failing the whole call when the other channel
still sent — see open question below); `invalid_request` (empty or unknown
`channels`).

**Publishing itself may still ask for a first send.** `send_mail` /
`send_whatsapp` on the publish call (B345/B365) stay — they are a
convenience on the *day* schema (owned by that area's design), not a second
sending mechanism; they should call the exact same `sendDayLetter` /
`sendDayWhatsapp` this endpoint calls, with `resend: false`. Flagging this in
the migration ledger for whoever owns `day.ts`'s publish route.

### 2.6 Journal channels — `/api/v2/{user}/channels`

**Purpose.** The owner's own mute switches for the two sending channels —
narrower than the server's capability, never wider (rule: a journal's config
narrows, never widens an instance ceiling). This is **not** the `features`
block the core journal schema deliberately excluded (that one is instance
plumbing, read-only, reported by `/api/health` and `/status`); it is a
distinct, small, owner-writable preference, scoped to this area because it
only ever gates the two doors above. See open question — it could instead
live as a section on the journal document; I recommend against that below.

**URL / verb / prefix / credential**: `GET` / `PATCH
/api/v2/{user}/channels` — bearer, owner-scope only.

**Edit schema**

| Field | Type | Class | Notes |
|---|---|---|---|
| `mail` | boolean | optional | Merge-patch: absent = unchanged. Refused `409 capability_unavailable` if the server has no mail plumbing at all. |
| `whatsapp` | boolean | optional | Same. |

Plain optional here, deliberately against the "asked-or-declined" default
(rule 2's carve-out: "where absent is the overwhelming default"). A mute
switch is not a section of a document being assembled from nothing — it is a
toggle with an existing value, and PATCH's whole contract is "send only what
changes."

**Read schema** — `{ mail: boolean | null, whatsapp: boolean | null }`,
`null` where the server does not offer the channel at all (so a switch that
cannot exist never reads back as a confident `false` — unchanged from v1).

**Refusals**: `forbidden`; `no_such_journal`; `capability_unavailable` (409);
`invalid_request` (unknown channel name, non-boolean value);
`too_many_requests`.

### 2.7 Reactions — `/api/web/{user}/trips/{trip}/days/{slug}/reactions`

**Argued placement: `/api/web`, not `/api/v2`.** An emoji reaction is cast by
a person looking at a page, identified only by a random id their own browser
generated and kept in `localStorage` — there is no account, no consent
flow, and structurally no reason an *agent* would ever cast one on a
reader's behalf. It is exactly what rule 13 calls "cookie-only browser
internals," even though the cookie itself is optional (an anonymous reader
of a public trip has none, and still votes). Putting it on `/api/v2` would
be the one door in this whole area a bearer token could reach that does
nothing an agent should ever do.

**URL / verbs / prefix / credential**: cookie-optional (`mayReadTrip`
reads one if present, else treats the trip as a public reader would).
- `GET /api/web/{user}/trips/{trip}/days/{slug}/reactions?voter={id}` — all
  counts, plus this voter's own picks.
- `POST /api/web/{user}/trips/{trip}/days/{slug}/reactions` — cast or change
  one vote.

Moved from a single flat `/api/reactions` keyed by trip-ref-in-body to a
nested path — cleaner REST, and the trip/day now come from the URL rather
than a body field, which a reviewer can see gated the same way every other
nested route is. The security property that made v1's flat shape careful
carries over unchanged and is worth restating because it is easy to lose in
the move: **a trip nobody may read must answer exactly as a trip that does
not exist**, and **a journal with reactions off must answer exactly as a
journal that does not exist** — both `404`, byte-identical, so this route
can never become an oracle for "does this trip/user exist" the way B117 and
B165 were fixed against elsewhere. `unknown_trip` here is deliberately `404`
rather than the `unknown_trip` used on write doors — see refusals below,
this is the one place in the whole v2 surface where "trip does not exist"
and "reactions are off" and "you may not read this trip" all answer with
the *same* code and body, because every caller here is anonymous by
construction and there is no later point where "you've proven you're the
owner" would let the route say more (rule that already existed in v1;
restated because the four-prefix, one-envelope discipline elsewhere in v2
tempts a reviewer to "fix" this into three distinct codes, which would
reopen the oracle).

**Edit schema (POST body)**

| Field | Type | Class | Notes |
|---|---|---|---|
| `voter` | string | required | Browser-generated, ≤64 chars. Not a person; a reaction from the same device with a cleared `localStorage` is a new voter. |
| `emoji` | string | required | One of the fixed reaction set (`lib/reactions.ts` — name the constant if this design is implemented: `REACTION_EMOJI`). |

**Read schema** — `{ counts: Record<emoji, number>, mine: Record<day, emoji> }`.

**Refusals**: `unknown_trip` (404 — covers "no such trip", "cannot read
this trip", and, doubling as —) `reactions_disabled` (404, distinct body,
same status, for "this journal has reactions off" so a caller can at least
tell "never was on" from "not this trip" without either being usable to
enumerate journals — matches v1's existing split); `bad_request` (missing
`voter`/`emoji`, malformed JSON); `too_many_requests`.

## 3. Proposed cuts

**Retire `personal` as a distinct invite kind.** It leads to exactly the
same place as `guest` (the table in `lib/contacts/invites.ts`'s own doc
comment says so) and exists only because it predates `guest`/`buddy` by one
decision (19, then 33). Folding it into `guest` removes one enum value, one
URL shape (`/{user}/i/<token>` vs `/{user}/invite/guest/<token>`), and the
whole `POST /api/contacts/request` route, whose only behavioural difference
from `redeem` was which token shape it accepted. Old `personal` rows and
old `/{user}/i/<token>` links keep working exactly as `unrecognised kind
reads as personal` already guarantees on the read side (`toKind`); creating
one is what stops. **Replaces with**: `kind: "guest"`.

**Cut the duplicate helper contact/channel doors.** `/api/helper/{user}/contacts/add-me`,
`/api/helper/{user}/contacts/import`, `/api/helper/{user}/channels` are
thin wrappers that already call the exact functions the API-side routes
call (`addSelfContact`, `importContactRows`, `setJournalFeatures`) with an
`isHelperOwner` cookie check instead of `isOwner`. In v2, the helper is one
more browser client of `/api/web` and `/api/v2` — it does not need its own
copy of a door that differs from the real one only in which cookie check
runs first. **Replaces with**: the helper calls `POST
/api/web/{user}/contacts/self`, `POST /api/v2/{user}/contacts/import` (it
already holds the owner's own token by construction), and `PATCH
/api/v2/{user}/channels` directly. The `wrote()`/`refused()` thread-logging
those routes do is a helper-conversation concern, not an API concern — it
belongs in the helper's tool-calling layer wrapping the shared endpoint,
not duplicated inside a second route.

**Consider retiring the contacts-only-visible `hasPostalAddress` field
outside the owner's own read** — currently duplicated with `address !==
null` on every reader of `ContactRecord`. Minor; noting it rather than
designing it, since address/postcard shape belongs to the media/postcards
area review, not this one.

**Nothing else to cut.** Every other v1 capability in this area answers a
real, distinct question an owner or a stranger actually asks; the buddy
link, the guest link, the whole confirm/approve queue, and both sending
channels all stay, re-housed rather than removed.

## 4. Migration ledger

| File | Action |
|---|---|
| `app/api/v1/[user]/invites/route.ts`, `.../invites/[id]/route.ts` | Rewrite as `app/api/v2/[user]/invites/route.ts` + `[id]/route.ts`. Split: `lib/contacts/invites.ts`'s `createInvite`/`listInvites`/`revokeInvite`/`inviteLinkUrl` stay (write half, unchanged); the route's own body-parsing becomes the zod schema above. |
| `app/api/contacts/request/route.ts` | Delete. Its one behaviour (personal-link guestbook) folds into `redeem`. |
| `app/api/contacts/redeem/route.ts`, `.../confirm/route.ts`, `.../ask/route.ts`, `.../self/route.ts`, `.../manage/route.ts` | Move under `app/api/web/[user]/contacts/*`, unchanged internals (`lib/contacts/index.ts`, `lib/contacts/invites.ts` untouched — this is a door move, not a logic rewrite). |
| `app/api/contacts/admin/route.ts` | Split into `app/api/v2/[user]/contacts/route.ts` (list/create), `[id]/route.ts` (GET/PATCH/DELETE), `[id]/approve`, `[id]/revoke`, `[id]/resend` route files. The `"invite"` case removed in B281 stays removed; every other `switch` case becomes its own route/verb. |
| `app/api/v1/[user]/contacts/import/route.ts` | Move to `app/api/v2/[user]/contacts/import/route.ts`, unchanged (`lib/contacts/importRows.ts` untouched). |
| `app/api/helper/[user]/contacts/add-me/route.ts`, `.../contacts/import/route.ts`, `.../channels/route.ts` | Delete (see cuts). The helper's own tool-calling layer (`lib/helper/tools/areas/*.ts`) calls the v2/web doors directly. |
| `app/api/v1/[user]/trips/[trip]/days/[slug]/send-mail/route.ts`, `.../send-whatsapp/route.ts` | Merge into `app/api/v2/[user]/trips/[trip]/days/[slug]/send/route.ts`. `lib/digest/dayLetter.ts` and `lib/digest/dayWhatsapp.ts` untouched (write half); `lib/api/dayMail.ts`/`dayWhatsapp.ts`'s summary shapes merge into one `results` object as shown in §2.5. |
| `app/api/v1/[user]/channels/route.ts` | Move to `app/api/v2/[user]/channels/route.ts`. `lib/journals.ts`'s `setJournalFeatures` untouched. |
| `app/api/reactions/route.ts` | Move to `app/api/web/[user]/trips/[trip]/days/[slug]/reactions/route.ts`. `lib/reactions.ts` untouched; the route's own trip-ref-in-body parsing becomes path params, and the `resolveReadableTrip` helper's two-refusal discipline moves with it verbatim — this is the one place in the migration where the *shape* of a refusal (not just its door) must not change. |
| `lib/contacts/invites.ts` (`InviteKind`) | Narrow the *write* union to `"guest" | "buddy"`; keep `personal` in the *read*/`toKind` union so old rows still resolve. |
| Data migration | None. Every table (`contacts`, `contact_invites`, `trip_people`, `access_grants`) is unchanged; this is a door re-housing, not a schema change. Existing `kind: "personal"` invite rows keep resolving via `toKind`'s existing fallback. |

## 5. Open questions

1. **Channels: its own tiny document, or a section of the journal
   document?** I designed it standalone (§2.6) because the core journal
   schema explicitly excluded all of `features` as instance-only and
   read-only, and a per-journal mute switch is neither. Folding it back into
   `journal.ts` would mean threading a narrow exception through a schema
   already reviewed field-by-field, which felt like the wrong place to
   reopen that review. **My default: keep it separate**, exactly as sized
   as it is today (two booleans).

2. **`send`'s per-channel failure shape.** Today a channel that is switched
   off answers the *whole call* with `400`/`503`-style refusal (v1's two
   separate routes each all-or-nothing). Combined into one call with
   `channels: ["mail", "whatsapp"]`, should a mail-off-but-whatsapp-on
   journal answer `200` with `results.mail: {attempted: false, reason:
   "mail_disabled"}` and `results.whatsapp: {attempted: true, sent: …}`, or
   should the whole call refuse if *any* requested channel cannot run?
   **My default: partial success, as drafted in §2.5** — the caller asked
   for two independent things and one succeeding should not be swallowed by
   the other failing; an agent reading `results.mail.reason` learns exactly
   as much as a dedicated refusal would have said.

3. **Should `POST /api/v2/{user}/invites` refuse a `buddy` link on a trip
   that already lists every real name in `trip.people`?** Nothing today
   stops an owner from making one anyway — it would just sit unused. Not
   worth refusing (a trip's people may grow), but worth a `note` in the
   create response nudging toward `trip.people` when the buddy link's only
   use would duplicate what the owner could type directly. **My default:
   no refusal, an informational note only** — matching rule 10 ("the server
   may act and inform").

4. **`contacts/self`'s continued existence is a bet that `trip.people`'s
   auto-mail will not always land** (mail off, journal newly enabled
   contacts after the trip was written, etc.). If the owner review of
   `trip.ts` decides the auto-mail is reliable enough to be the only road,
   `contacts/self` could retire too. **My default: keep it** — it costs one
   small route and closes a real gap the auto-mail cannot guarantee to close
   itself (mail is always best-effort in this codebase, per B272).
