---
id: B399
title: Every address in the book is typed out by hand, line by line, with nothing to check it against
type: FEATURE
priority: medium
complexity: high
area: contacts, capabilities, privacy
found: "2026-09-05T00:46:00Z"
started: "2026-09-05T07:35:23Z"
merged: "2026-09-05T08:01:40Z"
completed: "2026-09-05T09:12:44Z"
---

# B399 — Every address in the book is typed out by hand, line by line, with nothing to check it against

## Why

The address block in all four contact forms is six empty boxes. Somebody types
a street, a postcode and a city from memory or off a screenshot, and nothing
anywhere says whether that street exists, whether the postcode belongs to that
city, or whether the two are in the country selected. The first time a wrong
address is discovered is when a printed postcard does not arrive, which is
weeks later and costs the print run.

The owner asked for it in the form it is usually met: type "Bahnhofstr" and
pick the real address out of a list, with the rest filled in. Perfect in the
DACH region, and working elsewhere.

## Work

An **address lookup capability**, off by default like every other one
(`lib/capabilities.ts`), absent rather than broken when unconfigured, and
reported by `/api/health` with a reason when it is off.

**Provider: Photon (photon.komoot.io) by default.** It is OSM data, it needs
no key, and unlike Nominatim its usage policy permits type-ahead — so this
capability can be switched on and driven with no paid account, which
`AGENTS.md` requires of every feature here. Its DACH coverage is the best of
the free options and its US coverage is the weakest; leave the provider
configurable (`features.addressLookup.provider` / `url`, key from the
environment only) so an instance that cares about the US can point at MapTiler
or similar without a code change. Self-hosting Photon is the same switch.

**The browser never talks to the provider.** A server route proxies the
query — that is what keeps a key out of the client, keeps the provider from
seeing the reader's IP and referrer, and gives us somewhere to put a rate
limit (`lib/rateLimit.ts`). Treat the route as a public surface even though
the forms behind it are not all public: an open geocoding proxy is somebody
else's free API quota. Minimum query length, a debounce on the client, a cap
on results, and a rate limit per session and per address.

**Say what it does, where it does it.** Typing a family member's home address
into a box that quietly forwards each keystroke to a third party is not
something to discover afterwards. The form names the source of the
suggestions when the capability is on. Nothing is sent until somebody types in
the street field; the other fields never trigger a query.

Picking a result fills line1, postcode, city and country. The country arrives
as an ISO code, which is why **B398 lands first** — that ticket makes the
field able to hold one. Everything stays editable afterwards: a suggestion is
a shortcut, never a lock, and an address a provider does not know must still
be typeable by hand exactly as it is today.

Not doing: validating or correcting an address the person typed themselves, or
refusing to save one the provider does not recognise. Half the world's
addresses are not in OSM and a family member's farm is likelier than most to
be one of them.

## What Photon actually answers

Checked against the live service on 2026-09-05 so nobody has to guess the
shape. `GET https://photon.komoot.io/api/?q=Bahnhofstrasse%2012%20Zurich&limit=2&lang=de`
returns GeoJSON whose first feature carries exactly the fields this needs:

```json
{"properties": {"housenumber": "12", "street": "Bahnhofstrasse",
  "postcode": "8001", "city": "Zürich", "state": "Zürich",
  "country": "Schweiz", "countrycode": "CH", "type": "house"},
 "geometry": {"type": "Point", "coordinates": [8.5400775, 47.3682932]}}
```

So `line1` is `street` + `housenumber` (order is a per-country question —
`12 Bahnhofstrasse` is wrong in Zürich and right in Paris), `postcode` and
`city` map straight across, and `countrycode` is the ISO code B398's field
takes. `country` comes back already translated, which is why the code is the
thing to store.

`lang` is honoured and accepts `de`, `en`, `fr` and `it` — not `hu`, so map an
unsupported journal locale to `en` rather than sending it and hoping.

`type: "house"` marks a result precise enough to post to; a `street` or `city`
result is not, and offering one as if it were an address is how a card gets
sent to a road. Prefer the precise ones, and do not silently accept a vague
one when the person picks it — fill what it does know and leave the rest for
them.

## Acceptance

With the capability off: the address block is exactly what it is today, no
network call, and `/api/health` says why it is off. With it on and no key
configured: typing four characters into the street field offers real
addresses, and picking one fills the street, postcode, city and country, all
still editable. The provider is never contacted from the browser (check the
network panel). The proxy refuses an over-long query, an over-short one, and a
flood from one session. Tests cover the proxy's shape and its refusals with
the provider stubbed; the live provider is not called from the suite.

## Built

`lib/capabilities.ts`/`lib/config.ts` — a new `addressLookup` capability, off
by default, ceiling-then-opt-in like every other one. `ADDRESS_LOOKUP_PROVIDER_ENV`
in `lib/capabilities.ts` needs nothing for `provider: "photon"` (the default)
and requires `ADDRESS_LOOKUP_API_KEY` for any other provider name — unlike
`postcards`/`photobook`, an unrecognised provider is not refused, since every
provider here is the same plain GET and there is no per-backend client code to
be missing.

`lib/addressLookupTypes.ts` (no `server-only`) carries `MIN_QUERY_LEN` (3),
`MAX_QUERY_LEN` (200) and the `AddressSuggestion` shape, so the client
component can share both without pulling the fetch logic into the browser
bundle. `lib/addressLookup.ts` (`server-only`) is the actual Photon client:
`lookupAddresses(query, locale)`, capped at 8 results, `type: "house"` only,
housenumber-after-street for `DE`/`AT`/`CH`/`LI` and before elsewhere, `lang`
narrowed to `de`/`en`/`fr`/`it` (else `en`), never throws.

`app/api/address-lookup/route.ts` — the public proxy. `GET
?user=&q=&locale=`; 404 when the capability (per-journal) is off; 400 under
`MIN_QUERY_LEN` or over `MAX_QUERY_LEN`; `rateLimitFor("address-lookup",
clientIp, {max: 30, windowMs: 60_000})`; `cache-control: no-store`.

`components/AddressLookupField.tsx` — the shared combobox (same interaction
pattern as `CountryField`/`TelField`), a 300ms debounce, and `enabled={false}`
makes it exactly today's plain `<input>` with no timer and no fetch ever
started. Wired into the street field of all four forms (`ContactForm.tsx`,
`ContactsAdmin.tsx`'s `GuestForm`, `InviteRedeem.tsx`, `ContactManage.tsx`),
each gated on a new `addressLookupEnabled` prop threaded down from its page
the same way `postcardsEnabled`/`whatsappEnabled` already are. A pick fills
`line1`/`postcode`/`city`/`country` (the ISO2 `CountryField` already reads)
and leaves every field editable. `contact.addressLookupHint` (all three
locale files) names Photon/OpenStreetMap under the field whenever the
capability is on.

Tests: `test/address-lookup.test.ts` (provider client — DACH vs. French
ordering, `type` filtering, `hu`→`en`, key present/absent, provider failure/
throw both resolve to `[]`) and `test/address-lookup-route.test.ts` (capability
off → 404 with no fetch, length refusals before any fetch, a 30-request flood
from one address → 429). `global.fetch` is stubbed in every test; the live
service is never called from the suite.

Manual check against the live Photon service (dev server, capability on, no
key) reproduced the ticket's own recorded shape exactly — `Bahnhofstrasse 12`
in Zürich (CH), `112 rue de Maubeuge` in Paris (FR) housenumber-first — and
confirmed: off → 404 from the proxy and `/api/health` names the reason; on →
real suggestions at 4 characters; `grep` over `.next/static` and
`components/`/`app/` finds no `photon.komoot` string anywhere reachable from
the browser bundle; 30 requests/minute per IP triggers 429 with `Retry-After`.

## Security review

`claude-security:scan` could not run in this session — the `Workflow` tool
it depends on was not present here (dispatched via the `claude-security`
orchestrator agent, which confirmed the same and did nothing rather than
improvise a scan by hand). A manual pass over the diff instead: the proxy's
`user` param only ever answers the capability check (off and "no such user"
both return the same generic 404, so it cannot be used to enumerate
journals); `features.addressLookup.url` is operator-set server config, the
same trust boundary `postcards`/`photobook` provider URLs already sit at, not
new attacker-reachable surface; query building goes through
`URLSearchParams`/`new URL()`, never string concatenation; the response sets
`cache-control: no-store` and carries no secret. Whoever picks this up next
with a working `Workflow` tool should run `claude-security:scan` properly
against this diff before it ships — this note is a stand-in, not a
replacement.
