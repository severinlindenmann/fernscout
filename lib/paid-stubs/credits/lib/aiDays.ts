/* eslint-disable @typescript-eslint/no-unused-vars -- a stub keeps the real signature and ignores its arguments */
// Public stub: AI-day metering is not included in this build. Every call is
// allowed — the same "absent, not broken" posture every optional capability
// takes.
export type PlanLimitRefusal = {
  error: "plan_limit";
  limit: "aiDays" | "storage";
  used: number;
  allowed: number;
  plan: "free" | "pass" | "plus";
  upgradeUrl: string;
};

export type AiGate = { ok: true } | { ok: false; refusal: PlanLimitRefusal };

export async function mayUseAi(_owner: string): Promise<AiGate> {
  return { ok: true };
}

export type AiDaysStatus = { unlimited: true } | { unlimited: false; used: number; allowed: number; plan: "free" | "pass" | "plus" };

export async function aiDaysStatus(_owner: string): Promise<AiDaysStatus> {
  return { unlimited: true };
}

export async function checkAiDay(_owner: string, _trip: string, _date: string): Promise<AiGate> {
  return { ok: true };
}

export async function recordAiDay(_owner: string, _trip: string, _date: string): Promise<void> {}
