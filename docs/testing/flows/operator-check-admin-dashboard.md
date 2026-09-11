# Flow: operator-check-admin-dashboard

**Persona:** `operator` (docs/testing/personas/operator.md)
**Interface:** admin
**Capabilities exercised:** `logging`, `analytics`
**Device/locale:** run once at desktop width; `/admin` is an operator tool,
not a reader-facing surface, so a mobile check is not part of this flow
unless a ticket specifically asks for one.
**Check type:** technical (the numbers on the page trace to real rows, the
page is a 404 with no operator configured) and graphical (the dashboard
itself).

## Setup

1. Local dev server with `FERNSCOUT_ADMIN_EMAIL` set to a test address, and
   an identity cookie for that same address (`POST /api/auth/identity/request`
   + `/verify`, per AGENTS.md — never the six-digit agent-token flow, and
   never a bearer token).
2. `features.logging` on (server-only, one stdout line per request — method,
   path, user agent, never an IP or a query string) and `features.analytics`
   on for at least one journal, with `DATABASE_URL` set (`analytics` needs a
   database — a journal with none gets no page rather than an empty one).
3. `site.costs` in `site/config.json` (or `FERNSCOUT_CONFIG`) priced with at
   least one model and one fixed monthly line, so the dashboard has a real
   number to multiply usage against rather than a column of zeros.
4. At least one journal that has made a metered call (a helper turn, a
   transcription) since the identity cookie was minted, so the usage table
   has a row to show.

## Steps

1. As the `operator` persona, open `/admin`. Confirm it renders the cost
   dashboard — model calls, transcription minutes, sends, print orders — and
   every journal's credit balance and ledger.
2. Confirm the numbers shown trace to the `usage` table's own rows
   (`lib/usage.ts`) multiplied by the priced `costs` block, not to anything
   invented for the page.
3. Attempt to reach `/admin` with an ordinary owner's cookie session (signed
   into their own journal, not the operator's address). Confirm it is
   refused — `isOwner` answering yes for `FERNSCOUT_ADMIN_EMAIL` on every
   *journal* page is not the same as this address being let onto `/admin`;
   only the identity cookie proven for the exact configured address opens it.
4. Attempt to reach `/admin` with a bearer (agent) token instead of any
   cookie. Confirm it is refused — the page takes a cookie and never a
   bearer token, per AGENTS.md.
5. Unset `FERNSCOUT_ADMIN_EMAIL` and reload. Confirm `/admin` answers `404`
   for everybody, including the identity cookie from step 1 — the same
   behaviour every other instance has with no operator configured.
6. Turn `features.logging` off and confirm one stdout request log line
   stops appearing, with no IP or query string ever having been in it while
   it was on; turn `features.analytics` off for a journal and confirm that
   journal's page disappears rather than rendering empty.

## Done when

- `/admin` shows real numbers traceable to `usage` rows and the priced
  `costs` block (technical check).
- `/admin` is reachable only by the identity cookie proven for the exact
  configured `FERNSCOUT_ADMIN_EMAIL` address — refused for an ordinary
  owner's cookie, a bearer token, and (with the env var unset) for
  everybody (technical check).
- `logging`/`analytics` off behave as absent rather than broken — no log
  line, no empty analytics page (technical check, AGENTS.md's rule for every
  optional capability).
- The dashboard itself renders correctly at desktop width (graphical check).
