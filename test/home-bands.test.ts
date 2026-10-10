import { describe, expect, test } from "vitest";
import type { HomeJournal, HomeTrip } from "@/components/HomeJournals";
import { bandsFor, newestDay, phaseOf } from "@/lib/homeBands";

/**
 * Which trips `/` leads with — B-2975. Running is decided on the device from
 * the dates, not read from the saved `status`.
 */

const TODAY = "2026-10-10";

function trip(id: string, over: Partial<HomeTrip> = {}): HomeTrip {
  return {
    id,
    title: id,
    href: `/@x/trips/${id}`,
    through: "guest",
    status: "current",
    start: "2026-10-04",
    end: "2026-10-14",
    ...over,
  };
}

function journal(username: string, role: HomeJournal["role"], trips: HomeTrip[]): HomeJournal {
  return { username, title: username, tagline: "", href: `/@${username}`, role, trips };
}

describe("phaseOf", () => {
  test("is decided from the dates, so a stale saved status cannot keep a finished trip running", () => {
    expect(phaseOf(trip("a", { status: "current", end: "2026-10-09" }), TODAY)).toBe("past");
    expect(phaseOf(trip("a", { status: "upcoming", start: "2026-10-10" }), TODAY)).toBe("running");
    expect(phaseOf(trip("a", { status: "past", start: "2026-10-11", end: "2026-10-12" }), TODAY)).toBe("upcoming");
  });

  test("falls back to the saved status when the trip has no start", () => {
    expect(phaseOf(trip("a", { start: undefined, status: "upcoming" }), TODAY)).toBe("upcoming");
  });
});

describe("bandsFor", () => {
  test("a friend running with a recent day leads; a stale one is quiet", () => {
    const bands = bandsFor(
      [
        journal("anna", "guest", [trip("alps", { latest: { slug: "d", title: "D", date: "2026-10-09", href: "/d" } })]),
        journal("chris", "guest", [
          trip("patagonia", { start: "2026-08-01", end: "2026-11-30", latest: { slug: "e", title: "E", date: "2026-09-12", href: "/e" } }),
        ]),
      ],
      TODAY,
    );
    expect(bands.running.map((i) => i.trip.id)).toEqual(["alps"]);
    expect(bands.quiet.map((i) => i.trip.id)).toEqual(["patagonia"]);
  });

  test("a trip that began this week is running before anything is written", () => {
    const bands = bandsFor([journal("anna", "guest", [trip("alps", { start: "2026-10-08" })])], TODAY);
    expect(bands.running).toHaveLength(1);
  });

  test("friends are ordered by their newest day, and none of them is 'mine'", () => {
    const day = (date: string) => ({ slug: date, title: date, date, href: `/${date}` });
    const bands = bandsFor(
      [
        journal("anna", "guest", [trip("a", { latest: day("2026-10-06") })]),
        journal("ben", "guest", [trip("b", { latest: day("2026-10-09") })]),
      ],
      TODAY,
    );
    expect(bands.running.map((i) => i.trip.id)).toEqual(["b", "a"]);
    expect(bands.mine).toEqual([]);
  });

  test("the owner's own running trip is the strip, not a card", () => {
    const bands = bandsFor([journal("me", "owner", [trip("lofoten", { through: "owner" })])], TODAY);
    expect(bands.mine.map((i) => i.trip.id)).toEqual(["lofoten"]);
    expect(bands.running).toEqual([]);
  });

  test("a trip the reader travelled on is the strip too", () => {
    const bands = bandsFor([journal("anna", "traveller", [trip("alps", { through: "traveller" })])], TODAY);
    expect(bands.mine.map((i) => i.trip.id)).toEqual(["alps"]);
  });

  test("an unfinished draft stays reachable after its trip ended", () => {
    const draft = { slug: "d", title: "Day", date: "2026-08-02", href: "/d" };
    const bands = bandsFor(
      [journal("me", "owner", [trip("iceland", { through: "owner", start: "2026-07-30", end: "2026-08-05", status: "past", draft })])],
      TODAY,
    );
    expect(bands.mine.map((i) => i.trip.id)).toEqual(["iceland"]);
  });

  test("a test trip and an operator's journal are never on the road", () => {
    const bands = bandsFor(
      [
        journal("anna", "guest", [trip("rehearsal", { test: true })]),
        journal("other", "admin", [trip("x")]),
      ],
      TODAY,
    );
    expect(bands.running).toEqual([]);
    expect(bands.quiet).toEqual([]);
    expect(bands.earlier).toEqual([]);
  });

  test("upcoming trips are soonest first and capped at two", () => {
    const up = (id: string, start: string) => trip(id, { status: "upcoming", start, end: start });
    const bands = bandsFor(
      [journal("anna", "guest", [up("c", "2026-12-01"), up("a", "2026-10-21"), up("b", "2026-11-05")])],
      TODAY,
    );
    expect(bands.upcoming.map((i) => i.trip.id)).toEqual(["a", "b"]);
  });

  test("history is a count per journal, the reader's own first", () => {
    const past = (id: string) => trip(id, { status: "past", start: "2026-05-01", end: "2026-05-09" });
    const bands = bandsFor(
      [journal("anna", "guest", [past("a1"), past("a2")]), journal("me", "owner", [past("m1")])],
      TODAY,
    );
    expect(bands.earlier.map((e) => [e.journal.username, e.count, e.own])).toEqual([
      ["me", 1, true],
      ["anna", 2, false],
    ]);
  });
});

describe("newestDay", () => {
  test("is the newest readable day across journals", () => {
    const day = (date: string) => ({ slug: date, title: date, date, href: `/${date}` });
    const found = newestDay([
      journal("anna", "guest", [trip("a", { status: "past", latest: day("2026-06-02") })]),
      journal("ben", "guest", [trip("b", { status: "past", latest: day("2026-04-01") })]),
    ]);
    expect(found?.trip.id).toBe("a");
  });
});
