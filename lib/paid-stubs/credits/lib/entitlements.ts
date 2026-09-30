/* eslint-disable @typescript-eslint/no-unused-vars -- a stub keeps the real signature and ignores its arguments */
// Public stub: plan enforcement is not included in this build. Every owner
// is unlimited — the same "absent, not broken" posture every optional
// capability takes.
export type PlanKey = "free" | "pass" | "plus";
export type EntitlementSource = "stripe" | "apple" | "admin";
export type EntitlementStatus = "active" | "grace" | "ended" | "refunded";

export type PlanLimits = {
  aiDays: number;
  storageGb: number;
  includedPostcards: number;
  postcardPriceRappen: number;
  bookDiscountRappen: number;
  extraStorageGb: number;
  extraStoragePriceChf: number;
};

export type PlanOf = {
  plan: PlanKey;
  limits: PlanLimits;
  periodStart: string | null;
  periodEnd: string | null;
  source: EntitlementSource | null;
  unlimited: boolean;
};

export type Entitlement = {
  id: string;
  owner: string;
  plan: "pass" | "plus";
  source: EntitlementSource;
  providerRef: string | null;
  startsAt: string;
  endsAt: string;
  status: EntitlementStatus;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
};

const UNLIMITED_LIMITS: PlanLimits = {
  aiDays: Infinity,
  storageGb: Infinity,
  includedPostcards: Infinity,
  postcardPriceRappen: 0,
  bookDiscountRappen: 0,
  extraStorageGb: Infinity,
  extraStoragePriceChf: 0,
};

export function unlimitedPlan(): PlanOf {
  return { plan: "plus", limits: UNLIMITED_LIMITS, periodStart: null, periodEnd: null, source: null, unlimited: true };
}

export async function planOf(_owner: string): Promise<PlanOf> {
  return unlimitedPlan();
}

export async function entitlementHistory(_owner: string): Promise<Entitlement[]> {
  return [];
}

export type GrantPlanInput = {
  owner: string;
  plan: "pass" | "plus";
  source: EntitlementSource;
  providerRef?: string | null;
  startsAt: string;
  endsAt: string;
  periodStart: string;
  periodEnd: string;
};
export type GrantPlanResult = { ok: true; id: string } | { ok: false; reason: "no_database" | "duplicate" };

export async function grantPlan(_input: GrantPlanInput): Promise<GrantPlanResult> {
  return { ok: false, reason: "no_database" };
}

export async function endEntitlement(_owner: string, _id: string): Promise<boolean> {
  return false;
}
