import type { PostalAddress } from "./render.ts";

/**
 * Print providers: what each one's request looks like, and which are real.
 *
 * This file builds requests and does not send them. `lib/postcard/stannp.ts`
 * is what posts one, and it posts exactly the map `buildStannpRequest`
 * returns — the split is so the payload can be asserted in a test with no key,
 * no network and no account, which is the rule this repository is built on.
 *
 * Until B435 nothing here was called at all, and three fields had drifted from
 * the published API in the eighteen months nobody was checking. Anything added
 * below is a claim about somebody else's server: confirm it against their live
 * documentation, and see docs/providers/postcards.md.
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
  /**
   * The credit-ledger reference for this order — B07.
   *
   * `spend()` in `lib/credits.ts` writes a ledger row with `ref` set to the
   * order id before any money is considered spent; that row *is* the
   * recorded payment. `buildStannpRequest` refuses an empty string, which is
   * what keeps a real provider (once wired, B435) unreachable for an order
   * nobody paid for. `dry-run` never calls this function, so a fresh clone
   * with no payment on file is unaffected.
   */
  paymentRef: string;
};

export type PreparedRequest = {
  provider: ProviderName;
  method: "POST";
  url: string;
  /** Header names only — never the values, which are secrets. */
  authHeaders: string[];
  /** The request's text fields, verbatim. Files are added by the client. */
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
 *
 * `fields` is the request's actual text body, not a description of one:
 * `lib/postcard/stannp.ts` posts exactly this map and adds the two files. It
 * used to hold prose ("the rendered front PDF, as a file upload") because
 * nothing called it, and the moment something did, a second field list beside
 * this one would have been a list that disagreed with it within a month.
 */
export function buildStannpRequest(
  order: PostcardOrder,
  region: "eu" | "us" = "eu",
): PreparedRequest {
  if (!order.paymentRef) {
    throw new Error(
      "postcard provider: refusing to build a request with no recorded payment",
    );
  }
  return {
    provider: "stannp",
    method: "POST",
    url: `https://api-${region}1.stannp.com/v1/postcards/create`,
    authHeaders: ["Authorization"],
    fields: {
      test: String(order.test),
      size: "A6",
      // Stannp lays a white border over the front unless this is zero, which
      // would crop into art rendered to the bleed. B435.
      padding: "0",
      "recipient[firstname]":
        order.to.name.split(" ").slice(0, -1).join(" ") || order.to.name,
      "recipient[lastname]": order.to.name.split(" ").slice(-1).join(" "),
      "recipient[address1]": order.to.line1,
      ...(order.to.line2 ? { "recipient[address2]": order.to.line2 } : {}),
      "recipient[postcode]": order.to.postcode,
      // `city`, not `town` — the field this was written with is not the field
      // their reference documents, and an unrecognised one is dropped in
      // silence rather than refused.
      "recipient[city]": order.to.city,
      "recipient[country]": order.to.country ?? "CH",
    },
    requires: [
      "STANNP_API_KEY",
      "An account with credit on it",
      "features.postcards.live — until it is true, every request carries test=true",
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
function swissPostStatus(): { usable: boolean; reason: string } {
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
export function availableProviders(): Record<
  ProviderName,
  { ready: boolean; note: string }
> {
  return {
    "dry-run": {
      ready: true,
      note: "Writes print-ready files to ./out/postcards. No account.",
    },
    stannp: {
      ready: Boolean(process.env.STANNP_API_KEY),
      note: process.env.STANNP_API_KEY
        ? "Wired. Renders a free sample of every card unless features.postcards.live is true, in which case it prints and dispatches real paper."
        : "Wired, but STANNP_API_KEY is unset and a funded account is needed.",
    },
    swisspost: { ready: false, note: swissPostStatus().reason },
  };
}
