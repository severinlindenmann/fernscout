import type { PostalAddress } from "./render.ts";

/**
 * Print providers, prepared but not connected.
 *
 * Everything here builds a request and stops. No provider is called, because
 * calling one needs an account, and an account is the boundary this work
 * package deliberately stops at (see docs/plans/W13-postcards.md). What that
 * buys: the payload shapes, the auth models and the failure modes are settled
 * and tested against fixtures now, so wiring up a real key later is an
 * afternoon rather than a rewrite.
 *
 * The exact field names below are written from each provider's published API
 * and MUST be confirmed against their live documentation before the first real
 * send — see docs/providers/postcards.md for what to verify.
 */

export type ProviderName = "dry-run" | "stannp" | "swisspost";

export type PostcardOrder = {
  to: PostalAddress;
  /** Rendered front, single page, print-ready. */
  front: Uint8Array;
  /** Rendered back, single page, print-ready. */
  back: Uint8Array;
  /** True until you actually want paper to move. */
  test: boolean;
};

export type PreparedRequest = {
  provider: ProviderName;
  method: "POST";
  url: string;
  /** Header names only — never the values, which are secrets. */
  authHeaders: string[];
  /** Multipart field names and a description of each value. */
  fields: Record<string, string>;
  /** What must be true before this can succeed. */
  requires: string[];
};

/**
 * Stannp — the one that will still work from a hostel in month four.
 *
 * Official, documented, self-serve, and it prints and posts internationally.
 * Regional endpoints exist; EU is the right one for Swiss and European
 * recipients, both for postage cost and for where the data sits.
 */
export function buildStannpRequest(order: PostcardOrder, region: "eu" | "us" = "eu"): PreparedRequest {
  return {
    provider: "stannp",
    method: "POST",
    url: `https://${region}.stannp.com/api/v1/postcards/create`,
    authHeaders: ["Authorization"],
    fields: {
      test: String(order.test),
      size: "A6",
      front: "the rendered front PDF, as a file upload",
      back: "the rendered back PDF, as a file upload",
      "recipient[firstname]": order.to.name.split(" ").slice(0, -1).join(" ") || order.to.name,
      "recipient[lastname]": order.to.name.split(" ").slice(-1).join(" "),
      "recipient[address1]": order.to.line1,
      ...(order.to.line2 ? { "recipient[address2]": order.to.line2 } : {}),
      "recipient[postcode]": order.to.postcode,
      "recipient[town]": order.to.city,
      "recipient[country]": order.to.country ?? "CH",
    },
    requires: [
      "STANNP_API_KEY",
      "An account with credit on it",
      "Field names confirmed against the current Stannp API documentation",
    ],
  };
}

/**
 * Swiss Post PostCard Creator — free, and probably not usable.
 *
 * The only route to it is a reverse-engineered client
 * (abertschi/postcard_creator_wrapper), whose last code commit was August 2023
 * and which does not support two-factor authentication. SwissID has pushed 2FA
 * hard since. Its issue history is a list of breakages: anomaly detection,
 * changed token flows, migrated endpoints.
 *
 * Even working, the free allowance is roughly one card per week per account,
 * which makes it a nice weekly ritual and not a way to send ten cards.
 *
 * This is therefore documented and deliberately NOT implemented. See H10 in
 * docs/plans/W13-postcards.md: the spike is timeboxed, and abandoning it is an
 * acceptable — indeed expected — outcome.
 */
export function swissPostStatus(): { usable: boolean; reason: string } {
  return {
    usable: false,
    reason:
      "No official self-serve API. The community client is unmaintained since 2023, " +
      "predates mandatory SwissID 2FA, and the free allowance (about one card per week) " +
      "does not fit sending to a list. Use Stannp; revisit only if Swiss Post ships a " +
      "real API.",
  };
}

/** Providers that can be used today, with no account, for development. */
export function availableProviders(): Record<ProviderName, { ready: boolean; note: string }> {
  return {
    "dry-run": { ready: true, note: "Writes print-ready files to ./out/postcards. No account." },
    stannp: {
      ready: false,
      note: "Request builder written and tested; needs STANNP_API_KEY and a funded account.",
    },
    swisspost: { ready: false, note: swissPostStatus().reason },
  };
}
