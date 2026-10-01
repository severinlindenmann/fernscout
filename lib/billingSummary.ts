import "server-only";
import { isEnabled } from "@/lib/capabilities";
import { entitlementHistory, planOf, type PlanKey } from "@paid/billing/lib/entitlements";
import { aiDaysStatus } from "@paid/billing/lib/aiDays";
import { peekIncludedUsage } from "@paid/billing/lib/print-usage";

/**
 * One owner's plan, read the one way — B2622.
 *
 * `app/at/[user]/studio/account/page.tsx` built this inline (B2593); the
 * `/me` plan card (B2622) needs the same answer for the owner's own journal,
 * so this is the one place both ask rather than two copies of the same four
 * reads that could drift. Absent — not shown empty — when `billing` is off,
 * the same "absent, not broken" rule every optional capability follows.
 */
export type PlanSummary = {
  plan: PlanKey;
  /** `null` on Free, which has no period. */
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Only a paid Plus that is not cancelled renews; a pass, an admin grant
   *  and a cancelled Plus end on `periodEnd`. */
  renews: boolean;
  aiDays: { unlimited: true } | { unlimited: false; used: number; allowed: number };
  storageGb: number;
  /** Only Plus, bought through Stripe, has a subscription to manage. */
  hasStripeSubscription: boolean;
  /** `null` on Free (which has no entitlement row to name a source). An
   *  `apple` plan is managed in the App Store, not here — B2598. */
  source: "stripe" | "apple" | "admin" | null;
  /** `null` on Free and on pass/Plus with no included-postcard count left to
   *  track (there always is one today, but a plan with `includedPostcards: 0`
   *  would have nothing worth a meter for). */
  postcards: { used: number; allowed: number } | null;
  /** Rappen off every photobook — 0 off Free and the pass. */
  bookDiscountRappen: number;
};

/** The same period key `paid/postcard/lib/postcard/pricing.ts`'s own
 *  `postcardPeriodKey` builds, duplicated rather than imported: that module
 *  is postcard-checkout code with its own stub surface, and this needs
 *  nothing else from it. */
function postcardPeriodKey(plan: PlanKey, periodStart: string | null): string {
  return `postcard:${plan}:${periodStart ?? "none"}`;
}

export async function planSummaryFor(username: string): Promise<PlanSummary | undefined> {
  if (!isEnabled("billing")) return undefined;

  const current = await planOf(username);
  const status = await aiDaysStatus(username);
  const live = current.unlimited
    ? undefined
    : (await entitlementHistory(username)).find(
        (e) => (e.status === "active" || e.status === "grace") && e.plan === current.plan,
      );

  const includedPostcards = current.limits.includedPostcards;
  const postcards =
    !current.unlimited && Number.isFinite(includedPostcards) && includedPostcards > 0
      ? await peekIncludedUsage(username, postcardPeriodKey(current.plan, current.periodStart), includedPostcards).then(
          (usage) => ({ used: usage.used, allowed: includedPostcards }),
        )
      : null;

  return {
    plan: current.plan,
    periodEnd: current.unlimited ? null : current.periodEnd,
    cancelAtPeriodEnd: live?.cancelAtPeriodEnd ?? false,
    renews:
      current.plan === "plus" &&
      (current.source === "stripe" || current.source === "apple") &&
      !(live?.cancelAtPeriodEnd ?? false),
    aiDays: status.unlimited ? { unlimited: true } : { unlimited: false, used: status.used, allowed: status.allowed },
    storageGb: current.limits.storageGb,
    hasStripeSubscription: current.plan === "plus" && current.source === "stripe",
    source: current.source,
    postcards,
    bookDiscountRappen: current.unlimited ? 0 : current.limits.bookDiscountRappen,
  };
}
