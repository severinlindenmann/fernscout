# Adversarial review — Fernscout v2 API redesign

Grounded in OWASP API Security Top 10 (2023): BOLA (API1) still #1 by
attack share, BOPLA/mass-assignment (API3, merged 2019's "excessive data
exposure" + "mass assignment"), BFLA (API5), unrestricted resource
consumption (API4), improper inventory (API9). Also current guidance on
browser token storage: a bearer token reachable by page JS is readable by
any XSS on that page in one line (`document`/`fetch` interceptors, `window`
globals) — the only structural defence is not putting it where JS can read
it, not shortening its TTL. Short TTLs (RFC 6749 ecosystem guidance,
commonly 5–15 min for access tokens) bound *exposure*, they do not prevent
*theft*.

## 1. [HIGH] The cookie→bearer bridge is a new XSS blast radius v1 did not have

**Threat.** v1's `/agent` helper never puts a write credential where page
JS can read it: every helper route (`app/api/helper/[user]/**`) is gated by
`isHelperOwner` reading an **httpOnly** cookie server-side. An XSS on
`/agent` cannot read that cookie at all — `document.cookie` returns
nothing for it. v2's `POST /api/web/{user}/agent-token` (web.md §2.1)
deliberately does the opposite: it mints a real, usable v2 bearer token and
hands it to client-side JS, which then holds it "for the rest of that
browser tab's session" and attaches it as `Authorization: Bearer` on every
`/api/v2` call. That token *must* live somewhere JS can read it to be
attached to a `fetch` header — an in-memory variable is the best case, and
even that is fully exfiltratable by a single injected script the instant
it exists in the page's JS realm.

**What v2 says today.** "TTL short enough that a leaked one (XSS, a stray
log line) is a bounded exposure — 30 minutes" (web.md §2.1). The design
explicitly names XSS as the threat it is accepting, then treats a 30-minute
window as sufficient mitigation.

**Was v1 stronger?** Yes, structurally. v1's equivalent credential (the
guest/owner session cookie) is httpOnly and therefore unreadable by
injected JS, full stop — XSS on `/agent` in v1 lets an attacker *act as*
the page (CSRF-shaped, mitigated by SameSite/origin checks) but cannot
*exfiltrate a credential usable from outside the page*. v2 trades a
same-origin-bound cookie for a portable bearer token reachable by JS,
which is a strictly larger attack surface for the identical XSS
precondition.

**Recommendation.** Keep the thin proxy model v1 already had for the ~21
routes: `/api/web/{user}/...` endpoints that hold the cookie server-side
and forward to `/api/v2` with a server-minted, never-externalised token
(or call the same handler function directly, in-process). If the client
truly needs direct `/api/v2` access (e.g. to reuse existing frontend SDK
code), keep the bridge but say so as a real security tradeoff for the
owner to accept, not as a "bounded" one — it is not bounded, it is
time-limited, which is a different claim.

## 2. [HIGH] A leaked 30-minute bridge token can self-renew into a 7-day real agent token

**Threat.** auth.md §2.5 carries over B776 unchanged: `POST
/api/auth/{user}/handover` (mint) accepts *either* the owner's cookie *or*
"a live agent token may reach it with its own bearer to renew itself,"
checked by "the same `isOwner`-shaped guard." The bridge token from
finding 1 is described as scope `owner`, i.e. exactly the shape a real
agent token has. Nothing in auth.md or web.md excludes a bridge-minted
token from qualifying as "a live agent token" for this self-renewal path.

**What v2 says today.** Nothing rules this out. If a bridge token is
indistinguishable, at the `isOwner`-shaped guard, from a real 7-day agent
token minted through `/api/auth/codes/redeem`, then an attacker who steals
a 30-minute bridge token (via the XSS in finding 1) can immediately call
`POST /api/auth/{user}/handover` with it, get a 20-minute handover
credential, exchange that at `POST /api/auth/handover` for a fresh 7-day
agent token, and now holds durable write access to the whole journal long
after the 30-minute window and the browser tab are gone.

**Was v1 stronger?** Not directly comparable (v1 has no bridge token), but
v1's handover-self-renewal was scoped to a credential an owner had
deliberately caused to exist and hold for up to a week — never one minted
implicitly on every page load of a browser helper. Introducing a second,
shorter-lived, JS-exposed credential into the same self-renewal path
widens who can reach it.

**Recommendation.** Mark bridge-minted tokens with a distinct internal
flag (e.g. `origin: "web-bridge"` alongside `scope: "owner"`) and refuse
them explicitly at the handover-mint guard, the same way `handover` never
appears as a `for` value on the codes door. A credential meant to die in
30 minutes must not be able to mint one that lives for a week.

## 3. [MED] "Refreshed silently by the client before it lapses" removes the bound the TTL was supposed to buy

**Threat.** web.md §2.1 says the bridge token is "refreshed silently by
the client before it lapses." If the refresh call itself only needs the
still-present cookie (not the about-to-expire token), then the 30-minute
figure bounds nothing for as long as the tab stays open with a valid
cookie session — which, per auth.md, can be up to a year (`SESSION_TTL_MS`
on the guest/identity cookie the helper session ultimately rests on).

**What v2 says today.** The refresh mechanism is asserted but not
specified: does it require the still-valid *old* token, the cookie, or
both? If cookie alone, an attacker who has stolen one token (via the XSS
in finding 1) does not need the cookie again — they just replay the
still-fresh token repeatedly, or the *page itself* keeps minting fresh
ones as long as it is open in a tab the attacker also controls via the XSS.

**Was v1 stronger?** v1 had no equivalent — the cookie was the only
credential and refresh-by-cookie is exactly how session cookies always
work; the difference is v1's cookie was never JS-readable, so "the tab
silently keeps a live credential" was never a JS-exfiltratable fact.

**Recommendation.** Specify the refresh precondition explicitly in the
design doc (cookie presence should be required, which it likely is, but
say so), and cap total bridge-token lifetime per page load regardless of
refresh count (e.g. hard 4-hour ceiling forcing a full cookie re-check),
so "silently refreshed forever" is not the de facto behaviour of an
indefinitely open tab.

## 4. [MED] Blanket owner-scope bridge token is wider than any single action needs (BFLA/least privilege)

**Threat.** v1's 21 collapsed helper routes each did one narrow thing —
`day/media`, `day/publish`, `trip/*`, `journal`, `keys` — each reachable
only through its own route with its own logic. v2 replaces all of them
with one token scoped `owner, this journal only` (web.md §2.1), which per
`journalStatus.token.scope` semantics (auth.md §3) is full write access to
every trip, every day, every credential-management route (`/keys`),
`/invites`, and `/contacts` in the journal. A single XSS on any one
`/agent` page (say, the photo-description screen) now has a token that can
revoke the owner's own live agent tokens, create buddy invites onto any
trip, or edit trip visibility — capabilities that specific screen never
needed.

**What v2 says today.** No narrower scopes are minted per-flow; §3 of
auth.md explicitly recommends *against* adding finer-grained scopes
("keep the two-value enum as-is") — a reasonable call for *real* agent
tokens obtained deliberately, but the bridge token is minted implicitly,
on page load, for UI the person never asked to grant journal-wide write to.

**Was v1 stronger?** Yes — v1's blast radius per compromised route was one
capability (e.g. steal control of `day/media` alone), not journal-wide
write.

**Recommendation.** At minimum, log/rate-limit the bridge-token's use of
sensitive sub-scopes (`/keys`, `/invites`, `/contacts` writes) distinctly
from ordinary day/trip writes, or mint two flavours: a default narrower
scope for the `/agent` conversational/day-editing surface, and require a
fresh mint (re-checking the cookie) for the credential-management screens.

## 5. [MED] IP-only rate limiting on the address-dependent `403` in `/api/auth/codes` is an enumeration oracle under distributed IPs

**Threat.** auth.md §2.2 keeps B230's deliberate exception: `for:"write"`
with an address that is neither the owner nor on the named trip answers
`403 not_authorised` — truthfully, on purpose, unlike every other outcome
on that door which is a silent `202`. The rate limit named for this door
is "per-IP bucket, narrower for `for:"write"` than for `for:"read"`." A
distributed attacker (many IPs) can use this door to enumerate, for a
given `user`/`trip`, which email addresses are and are not on the trip's
`people:` list — a real information disclosure the rest of the door is
built to avoid (every other branch is uniform-202 specifically to prevent
this class of oracle).

**What v2 says today.** Only an IP-keyed bucket is specified; no
per-address or per-(user,trip) bucket is mentioned, so the bucket that
actually needs to survive a botnet (this one — it is the sole address-
disclosing branch on the whole door) is the one with the weakest stated
defence.

**Was v1 stronger?** Unclear from the docs alone — v1 had the same
disclosing 403 (§0.6 says this behaviour is unchanged, argued and kept
deliberately), so this is not a v2 regression, but the merge into one
door was the natural point to add a target-keyed bucket, and the design
doesn't take it.

**Recommendation.** Add a bucket keyed on `(user, trip)` or
`(user, email)`, independent of IP, capping total disclosing-403 answers
per target regardless of source IP.

## 6. [LOW] `declineReason` floor (10 chars) is meaningless as an accountability control

**Threat.** `lib/api/v2/schemas/shared.ts` enforces `min(10)` on every
`declined.<field>` reason. This satisfies "n/a" cannot pass, but "not
needed now." (16 chars) passes trivially and carries exactly as little
information. AGENTS.md frames decline reasons as "a message to the next
reader," which is a content property no length check can enforce — this
isn't a v2-specific security hole, but v2 is the layer choosing to
represent this as an enforced *rule* (422 otherwise), which invites
over-trusting the check.

**Was v1 stronger?** N/A — new mechanism in v2, no v1 equivalent.

**Recommendation.** No code change needed; the design doc's own text
already says "reasons are read, not branched on" — worth stating plainly
that the length floor is a UX nudge, not an integrity guarantee, so nobody
downstream treats a present `declined` entry as verified-meaningful.

## 7. [INFO] What v2 correctly preserves — no regression found

- **`GRANT_ALLOWED` stays two callers** (Stripe webhook + operator
  approval route), unchanged from v1, still asserted by
  `test/credits.test.ts` per money.md §2.5/§3. Nothing an agent or a v2
  document write can reach grants credits.
- **Stripe webhook verification** (signature over raw body, mode check,
  atomic once-only claim) is carried over verbatim — money.md does not
  weaken this path.
- **Uniform-202 posture** is preserved and, in the merged `/api/auth/codes`
  door, explicitly re-argued rather than silently dropped (auth.md §0.6,
  §2.2) — the one deliberate disclosing exception is the same one v1 had.
- **Trip-scoped token width is still fixed at issuance**, never re-read
  from the redemption body (`scope.trip` may only repeat what the code was
  issued for, refused otherwise) — B230's lesson survives the merge.
- **Mail-gated delete and postcard-send-is-owner-browser-only** are not
  touched by anything read in auth/web/social/money — no evidence of
  weakening.
- **Mass assignment**: every v2 schema file uses `z.strictObject` (43
  occurrences across the 8 schema files checked), which is the correct
  default posture against BOPLA-style over-posting — unknown fields are
  rejected, not silently dropped or accepted.
- **Client-chosen ids + 409-with-stored-document** (invites, credits
  purchase, etc.) is scoped to owner-only bearer/cookie routes in every
  instance reviewed, so the "409 discloses the existing document" pattern
  never crosses a trust boundary to a non-owner caller.

---

**Top 5 (severity order):**
1. Bridge token exposes an owner-scope bearer to page JS — a structural
   XSS blast-radius regression vs v1's httpOnly-cookie-only helper.
2. A stolen 30-minute bridge token can plausibly self-renew via the
   handover-mint route into a durable 7-day real agent token — no stated
   exclusion.
3. "Refreshed silently by the client" can make the 30-minute TTL
   unbounded for the life of the tab/cookie, undercutting its own
   rationale.
4. The bridge token is scoped to full journal-wide owner-write for every
   `/agent` screen, not scoped to the capability the screen actually needs.
5. `/api/auth/codes`'s deliberate address-disclosing 403 is rate-limited
   only per-IP, leaving it enumerable by a distributed attacker.
