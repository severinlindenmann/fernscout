import { describe, expect, test } from "vitest";
import { applyAcks, type Ack } from "@/lib/adminAcks";
import type { Attend } from "@/lib/adminConsole";

/**
 * What an acknowledgement hides, and — the half that matters — what it does
 * not — B1203.
 *
 * This is the one rule in the codebase whose failure mode is silence, and
 * silence is also what a working instance looks like. Nothing downstream can
 * catch a suppression that holds when it should have lapsed: the page renders,
 * the band is green, and the backup has been dead for a month. So the rule is
 * pure and it is pinned here.
 */

function entry(over: Partial<Attend> = {}): Attend {
  return {
    id: "backup:secondary",
    kind: "backup",
    title: "The off-site copy has not arrived in 226 hours",
    detail: "Remote refused.",
    age: "9d",
    level: 9,
    ...over,
  };
}

function ack(over: Partial<Ack> = {}): Ack {
  return {
    id: "press-1",
    entryId: "backup:secondary",
    level: 9,
    ackedAt: "2026-09-09T10:00:00.000Z",
    ackedBy: "agent@fernscout.ch",
    endedAt: null,
    endedWhy: "",
    ...over,
  };
}

describe("an acknowledged entry", () => {
  test("is hidden while it is no worse than it was", () => {
    const out = applyAcks([entry()], [ack()]);
    expect(out.shown).toEqual([]);
    expect(out.hidden.map((one) => one.id)).toEqual(["backup:secondary"]);
  });

  test("is still hidden when it gets better", () => {
    // A copy that arrived yesterday after a week of failing is the thing
    // improving. An acknowledgement that lapsed on any change at all would be
    // one that never held for a day, which is the same as not having it.
    const out = applyAcks([entry({ level: 3 })], [ack({ level: 9 })]);
    expect(out.shown).toEqual([]);
  });

  test("comes back the moment it is worse", () => {
    // The whole reason `level` exists. Without it, "never show me this again"
    // over a live measurement is a muzzle: acknowledged at nine days stale and
    // silent at ninety. B138 is two days of exactly that.
    const out = applyAcks([entry({ level: 10 })], [ack({ level: 9 })]);
    expect(out.shown.map((one) => one.id)).toEqual(["backup:secondary"]);
    expect(out.hidden).toEqual([]);
  });

  test("stops hiding anything once the acknowledgement has ended", () => {
    const out = applyAcks(
      [entry()],
      [ack({ endedAt: "2026-09-10T09:00:00.000Z", endedWhy: "fixed" })],
    );
    expect(out.shown.map((one) => one.id)).toEqual(["backup:secondary"]);
  });

  test("hides only its own entry", () => {
    const out = applyAcks([entry(), entry({ id: "disk:eva", kind: "disk", level: 96 })], [ack()]);
    expect(out.shown.map((one) => one.id)).toEqual(["disk:eva"]);
  });

  test("a fault, which has no size, is hidden while it is present", () => {
    // Level 0 both sides: a fault is happening or it is not, and `sweepAcks`
    // is what makes a recurrence news rather than something already answered.
    const out = applyAcks(
      [entry({ id: "basemap", kind: "fault", level: 0 })],
      [ack({ entryId: "basemap", level: 0 })],
    );
    expect(out.shown).toEqual([]);
  });

  test("a purchase filed after the queue was acknowledged shows through", () => {
    // `level` for the queue is the newest request as a number, so this is the
    // same rule and not a special case — and it is the one entry where getting
    // it wrong loses somebody's money in a suppression.
    const acked = Date.parse("2026-09-08T10:00:00.000Z");
    const out = applyAcks(
      [entry({ id: "approve", kind: "approve", level: Date.parse("2026-09-10T08:00:00.000Z") })],
      [ack({ entryId: "approve", level: acked })],
    );
    expect(out.shown.map((one) => one.id)).toEqual(["approve"]);
  });

  test("an older press of the same entry does not hold once it has ended", () => {
    // The history keeps every press, so the same entry legitimately has
    // several rows. Only the live one may hide anything — reading the wrong
    // row here would resurrect a suppression the operator ended in June.
    const out = applyAcks(
      [entry({ level: 20 })],
      [
        ack({ id: "june", level: 99, endedAt: "2026-07-01T00:00:00.000Z", endedWhy: "fixed" }),
        ack({ id: "august", level: 20 }),
      ],
    );
    expect(out.shown).toEqual([]);

    // And with only the ended one, nothing is hidden — despite its level
    // being far above the entry's.
    const alone = applyAcks(
      [entry({ level: 20 })],
      [ack({ id: "june", level: 99, endedAt: "2026-07-01T00:00:00.000Z", endedWhy: "fixed" })],
    );
    expect(alone.shown).toHaveLength(1);
  });

  test("no acknowledgements shows the whole band", () => {
    // The direction a failure has to fall in: `listAcks` answers with nothing
    // when it cannot read, and a failure to read the suppressions must never
    // look like a suppression.
    const items = [entry(), entry({ id: "approve", kind: "approve", level: 1 })];
    expect(applyAcks(items, []).shown).toHaveLength(2);
  });
});
