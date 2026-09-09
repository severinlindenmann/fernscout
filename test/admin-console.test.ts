import { describe, expect, test } from "vitest";
import { backupWrongs, takingsBreakdown, weekOf } from "@/lib/adminConsole";
import { byOperation } from "@/lib/instanceCosts";
import type { Payment } from "@/lib/payments";
import type { UsageTotal } from "@/lib/usage";
import type { BackupStatus } from "@/lib/backupStatus";

/**
 * The arithmetic behind the operator console — B996.
 *
 * Every function here is pure and the whole of what a panel claims, which is
 * exactly why they are worth a test: a takings figure that quietly counts a
 * grant as a sale, or a week bucket that puts Sunday in the wrong one, is a
 * wrong answer about money and about growth that nothing else would catch.
 */

function payment(over: Partial<Payment>): Payment {
  return {
    id: "p1",
    owner: "ana",
    credits: 50,
    amountRappen: 1000,
    status: "paid",
    method: "twint",
    createdAt: "2026-09-01T10:00:00.000Z",
    paidAt: "2026-09-01T10:05:00.000Z",
    requestedAt: null,
    providerRef: null,
    ...over,
  };
}

describe("takings", () => {
  test("a grant is never counted as money taken", () => {
    // The distinction the whole panel rests on: an instance that gives credits
    // away must not read as one that sells them.
    const out = takingsBreakdown(
      [payment({ method: "admin", amountRappen: 0, credits: 30 })],
      [],
    );
    expect(out.paidRappen).toBe(0);
    expect(out.grantedCredits).toBe(30);
    expect(out.byMethod).toHaveLength(0);
  });

  test("methods are summed and ordered by what each brought in", () => {
    const out = takingsBreakdown(
      [
        payment({ id: "a", method: "card", amountRappen: 500 }),
        payment({ id: "b", method: "twint", amountRappen: 1000 }),
        payment({ id: "c", method: "twint", amountRappen: 2000 }),
      ],
      [],
    );
    expect(out.paidRappen).toBe(3500);
    expect(out.byMethod.map((row) => row.method)).toEqual(["twint", "card"]);
    expect(out.byMethod[0]).toMatchObject({ rappen: 3000, count: 2 });
  });

  test("a refund is reported rather than netted off", () => {
    const out = takingsBreakdown(
      [
        payment({ id: "a", amountRappen: 1000 }),
        payment({ id: "b", status: "refunded", amountRappen: 400 }),
      ],
      [],
    );
    expect(out.paidRappen).toBe(1000);
    expect(out.refundedRappen).toBe(400);
  });

  test("what is waiting is money not yet taken, and a grant is not money", () => {
    const out = takingsBreakdown(
      [],
      [
        payment({ id: "w", status: "requested", amountRappen: 1000 }),
        payment({ id: "g", status: "requested", method: "admin", amountRappen: 0 }),
      ],
    );
    expect(out.waitingRappen).toBe(1000);
    expect(out.waitingCount).toBe(2);
  });
});

describe("weeks", () => {
  test("a week runs Monday to Sunday", () => {
    expect(weekOf("2026-09-07")).toBe("2026-09-07"); // a Monday
    expect(weekOf("2026-09-08")).toBe("2026-09-07");
    // Sunday belongs to the week that started six days earlier, not to the one
    // beginning tomorrow — the off-by-one that `getUTCDay` invites.
    expect(weekOf("2026-09-13")).toBe("2026-09-07");
    expect(weekOf("2026-09-14")).toBe("2026-09-14");
  });

  test("a date that is not one comes back empty rather than as an epoch", () => {
    expect(weekOf("not-a-date")).toBe("");
  });
});

describe("what the models were asked to do", () => {
  function total(over: Partial<UsageTotal>): UsageTotal {
    return {
      provider: "anthropic",
      model: "m",
      operation: "write_day",
      calls: 1,
      inputTokens: 0,
      outputTokens: 0,
      seconds: 0,
      ...over,
    };
  }

  const costs = {
    models: { m: { inputPerMillionRappen: 1_000_000, outputPerMillionRappen: 0 } },
    transcriptionPerThousandMinutesRappen: 0,
    fixedMonthly: [],
  };

  test("rows are grouped by operation across models, biggest first", () => {
    const out = byOperation(
      [
        total({ operation: "write_day", inputTokens: 1 }),
        total({ operation: "ask_thread", inputTokens: 3, calls: 2 }),
        total({ operation: "write_day", model: "m", inputTokens: 1, calls: 4 }),
      ],
      costs,
    );
    expect(out.map((row) => row.operation)).toEqual(["ask_thread", "write_day"]);
    expect(out[0]).toMatchObject({ rappen: 3, calls: 2 });
    expect(out[1]).toMatchObject({ rappen: 2, calls: 5 });
  });

  test("an unpriced model contributes nothing rather than a guess", () => {
    const out = byOperation([total({ model: "unknown", inputTokens: 10_000 })], costs);
    expect(out[0].rappen).toBe(0);
    expect(out[0].calls).toBe(1);
  });
});

/**
 * What the operator is woken for — B1174.
 *
 * The off-site copy is the half of the backup that survives losing the
 * machine, and it is also the half the nightly run cannot report on: the
 * primary alone decides whether a night succeeded (B651), so a secondary that
 * has stopped arriving exits zero, sends no mail, and shows up nowhere but
 * here. It showed up nowhere at all until this test existed.
 */
describe("backup alarms", () => {
  function status(over: Partial<BackupStatus> = {}, secondary: Partial<BackupStatus["secondary"]> = {}): BackupStatus {
    return {
      state: "ok",
      lastSuccessAt: "2026-09-09T01:00:00.000Z",
      lastFailureAt: null,
      ageHours: 2,
      maxAgeHours: 36,
      ...over,
      secondary: {
        state: "ok",
        lastSuccessAt: "2026-09-09T01:05:00.000Z",
        ageHours: 2,
        maxAgeHours: 36,
        ...secondary,
      },
    };
  }

  test("a healthy pair is silent", () => {
    expect(backupWrongs(status())).toEqual([]);
  });

  test("an off-site copy that has stopped arriving is an alarm, even with the primary fine", () => {
    // The exact shape of the failure this exists for: the nightly run is
    // succeeding, so nothing else in the system says a word.
    const out = backupWrongs(status({}, { state: "stale", ageHours: 74 }));
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("off-site copy");
    expect(out[0].title).toContain("74 hours");
    // It must say why no mail arrived, or the operator reads the silence as
    // evidence and this alarm as noise.
    expect(out[0].detail).toContain("no failure mail is sent");
  });

  test("an off-site copy nobody configured is NOT an alarm", () => {
    // `unknown` means "unset by choice" and "set and never once succeeded"
    // and nothing on disk separates them. Red on a legitimate configuration
    // is an alarm that gets ignored.
    expect(backupWrongs(status({}, { state: "unknown", lastSuccessAt: null, ageHours: null }))).toEqual([]);
  });

  test("both halves failing are two separate alarms, not one", () => {
    const out = backupWrongs(status({ state: "failing", lastFailure: "exit 1" }, { state: "stale", ageHours: 74 }));
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe("The backup is failing");
    expect(out[1].title).toContain("off-site copy");
  });

  test("a primary that has never run is an alarm — unlike the secondary, that is never a choice", () => {
    const out = backupWrongs(status({ state: "unknown", lastSuccessAt: null, ageHours: null }));
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("No backup has ever been recorded");
  });
});
