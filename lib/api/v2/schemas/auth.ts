// The credential doors under /api/auth, as v2 speaks them — B1600, phase 2
// step 2. `docs/plans/2026-09-12-api-v2/auth.md` §2.1-2.3 is the design.
//
// These are the request/response shapes for the two doors that replace six
// v1 routes (`/api/auth/{request,verify,link,identity/request,
// identity/verify,identity/link,signup/request,signup/verify}` →
// `/api/auth/codes`, `/api/auth/codes/redeem`, `/api/auth/links/redeem`).
// The cookie-lifecycle doors (`identity/upgrade`, `logout`) and handover/keys
// are unchanged in shape and carry no schema here.
import { z } from "zod";
import type { SessionKind } from "../../../auth";

/**
 * The wire vocabulary for "which credential this code or link redeems
 * into" — replaces v1's `kind: "guest" | "agent"`. `read` is today's `guest`,
 * `write` is today's `agent`; `identity` and `signup` are unchanged in
 * meaning. `handover` is deliberately absent: it is minted and exchanged by
 * its own pair of routes (`/api/auth/{user}/handover`, `/api/auth/handover`),
 * never redeemed from a code.
 */
export const CREDENTIAL_FOR = ["read", "write", "identity", "signup"] as const;
export type CredentialFor = (typeof CREDENTIAL_FOR)[number];

/**
 * The one place `for` becomes `SessionKind` — every route reads this rather
 * than carrying its own switch, so the wire vocabulary and the internal one
 * cannot drift apart the way a second copy always does.
 */
export const CREDENTIAL_TO_SESSION_KIND: Record<CredentialFor, SessionKind> = {
  read: "guest",
  write: "agent",
  identity: "identity",
  signup: "signup",
};

/** Which trip a `for:"write"` code may mint a token for — decided once, at
 * issue, and never re-read from the request at redemption (B230). */
const tripScope = z.strictObject({ trip: z.string() });

/** `POST /api/auth/codes` request — auth.md §2.2. Cross-field rules (`user`
 * required with `read`/`write`, `scope` only with `write`) are the route's
 * job, not the schema's: the shape check here is deliberately silent about
 * *why* a combination is refused, because that reasoning differs by whether
 * the address itself may say so (§0 property 6) and the schema has no way to
 * know which. */
export const codesRequest = z.strictObject({
  email: z.string(),
  for: z.enum(CREDENTIAL_FOR),
  user: z.string().optional(),
  scope: tripScope.optional(),
  channel: z.enum(["mail", "whatsapp"]).optional(),
  destination: z.string().optional(),
  locale: z.string().optional(),
});
export type CodesRequest = z.infer<typeof codesRequest>;

/** The one response `POST /api/auth/codes` gives on success — always `202`,
 * whatever the address (§0 property 6). */
export const codesRequestResponse = z.strictObject({
  status: z.literal("accepted"),
  next: z.string(),
});

/** `POST /api/auth/codes/redeem` request — auth.md §2.2. */
export const codesRedeemRequest = z.strictObject({
  email: z.string(),
  code: z.string(),
  for: z.enum(CREDENTIAL_FOR),
  user: z.string().optional(),
  scope: tripScope.optional(),
});
export type CodesRedeemRequest = z.infer<typeof codesRedeemRequest>;

/** `for:"read"`/`"identity"` — the cookie(s) are set on the response, and the
 * token is never in the body (decision 24). */
export const codesRedeemCookieResponse = z.strictObject({
  ok: z.literal(true),
  expires: z.string(),
  scope: z.enum(["read", "identity"]),
});

/** `for:"write"`/`"signup"` — the token is the whole body, and no cookie is
 * set (decision 24: an agent has no cookie jar). */
export const codesRedeemTokenResponse = z.strictObject({
  ok: z.literal(true),
  token: z.string(),
  expires: z.string(),
  scope: z.enum(["write", "signup"]),
  user: z.string().optional(),
});

/** `POST /api/auth/links/redeem` request — auth.md §2.3. A link only ever
 * exists for `read` or `identity`: an agent has no browser to follow one, and
 * a signup link would quietly create a journal on arrival. */
export const linksRedeemRequest = z.strictObject({
  token: z.string(),
  for: z.enum(["read", "identity"]),
  user: z.string().optional(),
});
export type LinksRedeemRequest = z.infer<typeof linksRedeemRequest>;

export const linksRedeemResponse = z.strictObject({
  ok: z.literal(true),
  next: z.string(),
});
