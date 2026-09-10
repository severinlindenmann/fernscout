import { describe, expect, test } from "vitest";
import { attention, funnel, type Activity, type Health } from "@/lib/adminConsole";
import type { Payment } from "@/lib/payments";
import type { JournalRow } from "@/lib/statusReport";

/**
 * The band above the tabs, and the funnel behind them — B1181.
 *
 * Both are pure functions over what `/admin` already fetched, which is the
 * whole reason they are worth a test: the band is the only list on the page
 * that claims *nothing needs you*, and a band that misses a kind is worse than
 * no band at all — it turns a fault into evidence that there is no fault.
 */

const NOW = new Date("2026-09-09T12:00:00.000Z");

function health(over: Partial<Health> = {}): Health {
  return {
    commit: "abc1234",
    uptimeSeconds: 3600,
    wrong: [],
    offByChoice: [],
    backupAgeHours: 2,
    backup: {
      state: "ok",
      lastSuccessAt: "2026-09-09T01:00:00.000Z",
      lastFailureAt: null,
      ageHours: 2,
      maxAgeHours: 36,
      secondary: {
        state: "ok",
        lastSuccessAt: "2026-09-09T01:05:00.000Z",
        ageHours: 2,
        maxAgeHours: 168,
      },
    },
    ...over,
  };
}

function journal(over: Partial<JournalRow> = {}): JournalRow {
  return {
    username: "ana",
    listed: true,
    trips: 1,
    tripsByVisibility: {},
    current: null,
    days: 3,
    drafts: 0,
    contacts: 0,
    guests: 0,
    credits: 100,
    bytes: 0,
    ...over,
  };
}

function payment(over: Partial<Payment> = {}): Payment {
  return {
    id: "p1",
    owner: "ana",
    credits: 50,
    amountRappen: 1000,
    status: "requested",
    method: "twint",
    createdAt: "2026-09-06T10:00:00.000Z",
    paidAt: null,
    requestedAt: "2026-09-06T10:00:00.000Z",
    providerRef: null,
    ...over,
  };
}

const QUIET = {
  awaiting: [],
  health: health(),
  troubles: [],
  journals: [journal()],
  ceiling: 5 * 1024 ** 3,
  balances: [{ username: "ana", balance: 100, granted: 100 }],
  now: NOW,
};

describe("what wants a person", () => {
  test("a well instance asks for nothing", () => {
    // The state the band claims most days. If this can return an entry on a
    // healthy instance, every real alarm is one more line in a list nobody
    // reads to the bottom of.
    expect(attention(QUIET)).toEqual([]);
  });

  test("a waiting purchase says how long the oldest has waited", () => {
    const out = attention({
      ...QUIET,
      awaiting: [
        payment({ id: "new", requestedAt: "2026-09-08T10:00:00.000Z" }),
        payment({ id: "old", requestedAt: "2026-09-06T10:00:00.000Z" }),
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("approve");
    expect(out[0].title).toContain("2 purchases");
    // The oldest, not the first in the array — the queue arrives newest-first
    // as often as not.
    expect(out[0].age).toBe("oldest 3d");
    // It shows and cannot approve, and it has to say so: the token that grants
    // is in a mailbox, deliberately.
    expect(out[0].detail).toContain("mailbox");
  });

  test("a stale backup is one entry, filed as a backup rather than as a fault", () => {
    // `backupWrongs` puts these into `health.wrong` with everything else. If
    // they were copied out rather than moved, an operator would read the same
    // stale copy twice and trust the count less for it.
    const out = attention({
      ...QUIET,
      health: health({
        wrong: [
          {
            id: "backup:secondary",
            title: "The off-site copy is 226 hours old",
            detail: "Remote refused.",
            backup: true,
          },
        ],
        backup: {
          ...health().backup,
          lastSuccessAt: "2026-08-31T03:22:00.000Z",
        },
      }),
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("backup");
    expect(out[0].age).toBe("9d");
  });

  test("a journal near its ceiling is on the list before the upload is refused", () => {
    const ceiling = 5 * 1024 ** 3;
    const out = attention({
      ...QUIET,
      journals: [journal({ username: "eva", bytes: Math.round(ceiling * 0.96) })],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("disk");
    expect(out[0].title).toContain("96%");
  });

  test("half a ceiling is headroom and says nothing", () => {
    const ceiling = 5 * 1024 ** 3;
    expect(
      attention({ ...QUIET, journals: [journal({ bytes: Math.round(ceiling * 0.5) })] }),
    ).toEqual([]);
  });

  test("a journal that was never granted anything has not run out of anything", () => {
    // The alarm this must not raise: a fresh journal on an instance with
    // credits switched on holds nothing and has done nothing wrong.
    expect(
      attention({ ...QUIET, balances: [{ username: "new", balance: 0, granted: 0 }] }),
    ).toEqual([]);
  });

  test("a journal that has spent what it was given is named", () => {
    const out = attention({
      ...QUIET,
      balances: [
        { username: "marek", balance: 2, granted: 300 },
        { username: "ana", balance: 100, granted: 100 },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("credits");
    expect(out[0].detail).toContain("marek");
    expect(out[0].detail).not.toContain("ana");
  });

  test("a purchase outranks a fortnight-old disk warning", () => {
    // Ordered by kind and never by age: somebody's money today is above a
    // warning that will still be true tomorrow.
    const ceiling = 5 * 1024 ** 3;
    const out = attention({
      ...QUIET,
      awaiting: [payment()],
      journals: [journal({ bytes: ceiling })],
      health: health({ wrong: [{ id: "db", title: "The database is unreachable", detail: "…" }] }),
    });
    expect(out.map((one) => one.kind)).toEqual(["approve", "fault", "disk"]);
  });
});

/**
 * The funnel — the only figure on the console that says whether the software
 * works, and the one whose null case matters most.
 */
describe("does anybody get through", () => {
  function activity(over: Partial<Activity> = {}): Activity {
    return { days: 0, recentDays: 0, lastDay: null, lastWroteAt: null, ...over };
  }

  test("counts each drop-off between the steps that caused it", () => {
    const steps = funnel(
      {
        arrived: "2026-08-01",
        wroteOnly: "2026-08-02",
        published: "2026-08-03",
        stillGoing: "2026-08-04",
      },
      {
        arrived: activity(),
        wroteOnly: activity({ days: 2, lastWroteAt: "2026-08-10T00:00:00.000Z" }),
        published: activity({ days: 2, lastWroteAt: "2026-08-10T00:00:00.000Z" }),
        stillGoing: activity({ days: 5, lastWroteAt: "2026-09-08T00:00:00.000Z" }),
      },
      { arrived: 0, wroteOnly: 0, published: 1, stillGoing: 4 },
      90,
      NOW,
    );
    expect(steps?.map((step) => step.count)).toEqual([4, 3, 2, 1]);
    expect(steps?.[1].lost).toBe("1 never wrote anything");
    // The gap the helper exists to close: a day written and never published.
    expect(steps?.[2].lost).toBe("1 has a draft and never published");
    expect(steps?.[3].lost).toBe("1 has gone quiet since");
  });

  test("is cohorted by arrival, so an old journal is not in this quarter's numbers", () => {
    const steps = funnel(
      { old: "2020-01-01", recent: "2026-09-01" },
      { old: activity({ days: 9 }), recent: activity() },
      { old: 9, recent: 0 },
      90,
      NOW,
    );
    expect(steps?.[0].count).toBe(1);
  });

  test("no database is null, never four zeroes", () => {
    // Zero would be a claim that nobody arrived. The truth is that there is
    // nowhere an arrival is recorded, and the page has to say that instead.
    expect(funnel(null, {}, {}, 90, NOW)).toBeNull();
  });
});
