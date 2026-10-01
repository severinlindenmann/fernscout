/* eslint-disable @typescript-eslint/no-unused-vars -- a stub keeps the real signature and ignores its arguments */
// Public stub: included-print metering is not included in this build. Every
// owner reads as having used none of an unlimited allowance — the same
// "absent, not broken" posture every optional capability takes.
export type IncludedUsage = { used: number; remaining: number };

export async function peekIncludedUsage(_owner: string, _periodKey: string, _limit: number): Promise<IncludedUsage> {
  return { used: 0, remaining: Infinity };
}

export async function reserveIncludedPrints(
  _owner: string,
  _periodKey: string,
  _limit: number,
  want: number,
): Promise<number> {
  return want;
}

export async function releaseIncludedPrints(_owner: string, _periodKey: string, _count: number): Promise<void> {}
