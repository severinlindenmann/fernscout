import { describe, expect, test } from "vitest";
import { estimateCost } from "../scripts/eval-compose/cost";

/**
 * The pre-flight cost guard B2692's acceptance names ("ask the owner before
 * each run") — not an invoice, just a plan that grows with what it is
 * asked to plan for, so a caller can trust "more cases costs more" without
 * reading the arithmetic.
 */
describe("estimateCost", () => {
  test("more cases costs more", () => {
    const small = estimateCost({ cases: 5, pairwise: false, judgesEnabled: false, composeModel: "claude-sonnet-5", judgeModel: "claude-haiku-4-5" });
    const big = estimateCost({ cases: 50, pairwise: false, judgesEnabled: false, composeModel: "claude-sonnet-5", judgeModel: "claude-haiku-4-5" });
    expect(big.estimatedUsd).toBeGreaterThan(small.estimatedUsd);
    expect(big.composeCalls).toBeGreaterThan(small.composeCalls);
  });

  test("judges off by default costs nothing extra — only the composer is planned", () => {
    const plan = estimateCost({ cases: 10, pairwise: false, judgesEnabled: false, composeModel: "claude-sonnet-5", judgeModel: "claude-haiku-4-5" });
    expect(plan.judgeCalls).toBe(0);
    expect(plan.totalCalls).toBe(plan.composeCalls);
  });

  test("judgesEnabled adds judge calls and cost", () => {
    const off = estimateCost({ cases: 10, pairwise: false, judgesEnabled: false, composeModel: "claude-sonnet-5", judgeModel: "claude-haiku-4-5" });
    const on = estimateCost({ cases: 10, pairwise: false, judgesEnabled: true, composeModel: "claude-sonnet-5", judgeModel: "claude-haiku-4-5" });
    expect(on.judgeCalls).toBeGreaterThan(0);
    expect(on.estimatedUsd).toBeGreaterThan(off.estimatedUsd);
  });

  test("pairwise roughly doubles the composer calls", () => {
    const single = estimateCost({ cases: 10, pairwise: false, judgesEnabled: false, composeModel: "claude-sonnet-5", judgeModel: "claude-haiku-4-5" });
    const paired = estimateCost({ cases: 10, pairwise: true, judgesEnabled: false, composeModel: "claude-sonnet-5", judgeModel: "claude-haiku-4-5" });
    expect(paired.composeCalls).toBeGreaterThanOrEqual(single.composeCalls * 2 - 1);
  });

  test("an unknown model falls back to a price rather than throwing", () => {
    expect(() => estimateCost({ cases: 1, pairwise: false, judgesEnabled: false, composeModel: "some-future-model", judgeModel: "claude-haiku-4-5" })).not.toThrow();
  });
});
