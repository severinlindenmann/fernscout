import "server-only";
import Stripe from "stripe";
import type { CreditTier } from "./credits/pricing";
import type { Payment } from "./payments";

/**
 * Stripe, and the one switch that says which world it is in — B792.
 *
 * ## The key is the switch
 *
 * There is no `sandbox: true` anywhere, and there must not be. Stripe already
 * says which mode a credential belongs to in the credential itself —
 * `sk_test_…` against the sandbox, `sk_live_…` against real money — so a second
 * flag beside it could only ever be a flag that disagrees with it, and the way
 * that disagreement resolves is an instance taking real money while every
 * screen it renders says "test". `stripeMode()` reads the prefix, `/api/health`
 * prints it, and switching this instance to live is replacing one environment
 * variable.
 *
 * ## Absent is a supported state
 *
 * With no key, `stripeEnabled()` is false and nothing here is reached: the
 * operator-approval-by-mail path (B425) runs exactly as it did, which is what
 * keeps local development and every other instance working with no Stripe
 * account at all — AGENTS.md's rule that no feature needs a paid account to
 * develop or test.
 *
 * **Both variables or neither.** A secret key without `STRIPE_WEBHOOK_SECRET`
 * would take a buyer to a real checkout page that no signature could confirm:
 * money leaves and no credit ever lands. That is worse than not offering the
 * payment at all, so it counts as not configured and `/api/health` says which
 * variable is missing.
 *
 * ## What this file never does
 *
 * It never touches a balance. `grant` lives behind the webhook's once-only
 * claim (`claimProviderPayment` in `lib/payments.ts`), exactly as the operator
 * approval path does, and `test/credits.test.ts` still holds the allowlist.
 */

export function stripeMode(): "test" | "live" | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  // Restricted keys (`rk_`) carry the same infix, and are the better thing to
  // deploy: this integration needs Checkout Sessions written and read, nothing
  // else.
  return /^(sk|rk)_live_/.test(key) ? "live" : "test";
}

/** Which environment variable is missing, if the provider is not usable.
 *  Names only — never a value. */
export function stripeProblem(): string | null {
  if (!process.env.STRIPE_SECRET_KEY?.trim()) return "STRIPE_SECRET_KEY is not set";
  if (!process.env.STRIPE_WEBHOOK_SECRET?.trim()) return "STRIPE_WEBHOOK_SECRET is not set";
  return null;
}

export function stripeEnabled(): boolean {
  return stripeProblem() === null;
}

let client: Stripe | null = null;

/** The SDK, made once. Throws rather than returning a half-configured client:
 *  every caller has already asked `stripeEnabled()`. */
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("stripe: STRIPE_SECRET_KEY is not set");
  if (!client) client = new Stripe(key);
  return client;
}

export function webhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("stripe: STRIPE_WEBHOOK_SECRET is not set");
  return secret;
}

/**
 * The buyer's hosted checkout page.
 *
 * **No Product and no Price is created, here or anywhere.** The line item is
 * built inline from the tier, so `lib/credits/pricing.ts` stays the single
 * place a price is written down; a Product in the Stripe dashboard would be a
 * second copy of the price, and a second copy is one that disagrees within a
 * month. Nothing needs setting up in the dashboard for this to work except
 * turning the payment methods on.
 *
 * **The methods are named, and deliberately.** `card` carries Apple Pay and
 * Google Pay by itself — Stripe offers the wallet whenever the device has one,
 * and a Stripe-hosted page needs no Apple Pay domain registration of our own —
 * and `twint` is what a Swiss buyer reaches for first. Naming them rather than
 * using `automatic_payment_methods` keeps Klarna, Amazon Pay, Link and the rest
 * of what a CHF account has switched on out of a page that is buying credits
 * for a travel journal. Adding one is a line here.
 *
 * `metadata` is what the webhook trusts: the payment id is looked up against
 * our own row and the amount re-checked, so a session cannot name a journal it
 * did not pay for.
 */
export async function createCheckoutSession(
  payment: Payment,
  tier: Pick<CreditTier, "credits">,
  username: string,
  baseUrl: string,
  locale?: string,
): Promise<string | null> {
  const back = `${baseUrl}/${username}/payment/${payment.id}`;
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card", "twint"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "chf",
          unit_amount: payment.amountRappen,
          product_data: {
            name: `${tier.credits} Fernscout credits`,
            description: `Credits for ${username}`,
          },
        },
      },
    ],
    client_reference_id: payment.id,
    metadata: { owner: payment.owner, paymentId: payment.id },
    // Both land back on our own checkout page, which reads the row and says
    // where it stands — the webhook, not this redirect, is what grants.
    success_url: `${back}?returned=1`,
    cancel_url: back,
    locale: locale === "de" ? "de" : locale === "hu" ? "hu" : "en",
  });
  return session.url;
}
