import { describe, expect, test } from "vitest";
import {
  DEFAULT_GAP_HOURS,
  clusterMedia,
  dateOf,
  fillMissingCoordinates,
  type Locatable,
} from "@/lib/ingest/cluster";
import { distanceKm, geodataAvailable, reverseGeocode } from "@/lib/ingest/geo";
import { guessTransport } from "@/lib/ingest";

/** `2026-08-14T09:30` as the sortable wall-clock number. */
function at(iso: string): number {
  return Date.parse(`${iso}:00.000Z`);
}

const BANGKOK = { lat: 13.75, lng: 100.49 };
const CHIANG_MAI = { lat: 18.79, lng: 98.98 };

describe("clustering", () => {
  test("a quiet day is one entry", () => {
    const clusters = clusterMedia([
      { takenAtMs: at("2026-08-14T09:00"), ...BANGKOK },
      { takenAtMs: at("2026-08-14T10:15"), ...BANGKOK },
      { takenAtMs: at("2026-08-14T11:40"), ...BANGKOK },
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].date).toBe("2026-08-14");
    expect(clusters[0].items).toHaveLength(3);
  });

  test("a new calendar date always starts a new entry", () => {
    // Twenty minutes apart, but across midnight: the site is organised by day,
    // so this is structure rather than a heuristic.
    const clusters = clusterMedia([
      { takenAtMs: at("2026-08-14T23:50"), ...BANGKOK },
      { takenAtMs: at("2026-08-15T00:10"), ...BANGKOK },
    ]);
    expect(clusters.map((c) => c.date)).toEqual(["2026-08-14", "2026-08-15"]);
  });

  test("a long gap splits a day into morning and evening", () => {
    const clusters = clusterMedia([
      { takenAtMs: at("2026-08-14T08:00"), ...BANGKOK },
      { takenAtMs: at("2026-08-14T09:00"), ...BANGKOK },
      { takenAtMs: at("2026-08-14T19:00"), ...BANGKOK },
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].items).toHaveLength(2);
  });

  test("the gap is configurable and can be widened to keep a day whole", () => {
    const items = [
      { takenAtMs: at("2026-08-14T08:00"), ...BANGKOK },
      { takenAtMs: at("2026-08-14T19:00"), ...BANGKOK },
    ];
    expect(clusterMedia(items, { gapHours: 24 })).toHaveLength(1);
    expect(clusterMedia(items, { gapHours: DEFAULT_GAP_HOURS })).toHaveLength(2);
  });

  test("moving a long way splits, even without a gap in time", () => {
    const clusters = clusterMedia([
      { takenAtMs: at("2026-08-14T08:00"), ...BANGKOK },
      { takenAtMs: at("2026-08-14T09:00"), ...BANGKOK },
      { takenAtMs: at("2026-08-14T10:00"), ...CHIANG_MAI },
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[1].lat).toBeCloseTo(CHIANG_MAI.lat, 2);
  });

  test("one bad GPS fix does not split a lunch into three entries", () => {
    // Distance is measured against the cluster's running centre, so a single
    // wild reading is outvoted by the photos either side of it.
    const clusters = clusterMedia([
      { takenAtMs: at("2026-08-14T12:00"), ...BANGKOK },
      { takenAtMs: at("2026-08-14T12:05"), ...BANGKOK },
      { takenAtMs: at("2026-08-14T12:10"), lat: 13.9, lng: 100.9 },
      { takenAtMs: at("2026-08-14T12:15"), ...BANGKOK },
      { takenAtMs: at("2026-08-14T12:20"), ...BANGKOK },
    ]);
    expect(clusters).toHaveLength(1);
  });

  test("the cluster's position is the median, not the mean", () => {
    const clusters = clusterMedia([
      { takenAtMs: at("2026-08-14T12:00"), lat: 13.75, lng: 100.49 },
      { takenAtMs: at("2026-08-14T12:05"), lat: 13.76, lng: 100.5 },
      { takenAtMs: at("2026-08-14T12:10"), lat: 13.77, lng: 100.51 },
    ]);
    expect(clusters[0].lat).toBeCloseTo(13.76, 5);
  });

  test("items arrive in time order however they were listed", () => {
    const clusters = clusterMedia([
      { takenAtMs: at("2026-08-14T18:00") },
      { takenAtMs: at("2026-08-14T09:00") },
      { takenAtMs: at("2026-08-14T13:00") },
    ]);
    const times = clusters.flatMap((c) => c.items.map((i) => i.takenAtMs));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  test("photos with no fix at all still cluster by time", () => {
    const clusters = clusterMedia([
      { takenAtMs: at("2026-08-14T09:00") },
      { takenAtMs: at("2026-08-15T09:00") },
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].lat).toBeUndefined();
  });
});

describe("borrowing coordinates from a neighbour", () => {
  test("the camera in the same bag as the phone gets the phone's fix", () => {
    const filled = fillMissingCoordinates<Locatable>([
      { takenAtMs: at("2026-08-14T09:00"), ...BANGKOK },
      { takenAtMs: at("2026-08-14T09:05") },
    ]);
    expect(filled[1].lat).toBeCloseTo(BANGKOK.lat, 5);
  });

  test("a fix from days away is not borrowed", () => {
    const filled = fillMissingCoordinates<Locatable>([
      { takenAtMs: at("2026-08-14T09:00"), ...BANGKOK },
      { takenAtMs: at("2026-08-20T09:00") },
    ]);
    expect(filled[1].lat).toBeUndefined();
  });

  test("nothing to borrow from leaves everything alone", () => {
    const items: Locatable[] = [{ takenAtMs: at("2026-08-14T09:00") }];
    expect(fillMissingCoordinates(items)).toEqual(items);
  });
});

describe("distance", () => {
  test("agrees with the known Bangkok–Chiang Mai great circle", () => {
    expect(distanceKm(13.75, 100.49, 18.79, 98.98)).toBeCloseTo(583, 0);
  });

  test("crossing the antimeridian is a short hop, not a lap of the planet", () => {
    expect(distanceKm(-18, 179.9, -18, -179.9)).toBeLessThan(30);
  });
});

describe("dates", () => {
  test("read back exactly as the wall clock wrote them", () => {
    expect(dateOf(at("2026-08-14T23:59"))).toBe("2026-08-14");
    expect(dateOf(at("2026-08-15T00:00"))).toBe("2026-08-15");
  });
});

describe("transport guesses", () => {
  test("600 km in two hours is a flight", () => {
    expect(
      guessTransport(
        { ...BANGKOK, takenAtMs: at("2026-08-18T08:00") },
        { ...CHIANG_MAI, takenAtMs: at("2026-08-18T10:00") },
      ),
    ).toBe("flight");
  });

  test("the same 600 km overnight is not guessed at all", () => {
    // Sleeper train, night bus or a long drive — the timestamps cannot tell
    // them apart, and a wrong guess costs the author an edit.
    expect(
      guessTransport(
        { ...BANGKOK, takenAtMs: at("2026-08-18T18:00") },
        { ...CHIANG_MAI, takenAtMs: at("2026-08-19T08:00") },
      ),
    ).toBeUndefined();
  });

  test("a walk across town is never transport", () => {
    expect(
      guessTransport(
        { lat: 13.75, lng: 100.49, takenAtMs: at("2026-08-18T08:00") },
        { lat: 13.76, lng: 100.52, takenAtMs: at("2026-08-18T08:20") },
      ),
    ).toBeUndefined();
  });
});

describe.runIf(geodataAvailable())("offline reverse geocoding", () => {
  test("names the city a person would name", () => {
    expect(reverseGeocode(13.75, 100.4913)?.name).toBe("Bangkok");
    expect(reverseGeocode(15.8801, 108.338)?.country).toBe("Vietnam");
    expect(reverseGeocode(15.8801, 108.338)?.countryCode).toBe("VN");
  });

  test("resolves near the antimeridian without going round the world", () => {
    const place = reverseGeocode(-18.14, 178.44);
    expect(place?.countryCode).toBe("FJ");
    expect(place?.distanceKm).toBeLessThan(20);
  });

  test("mid-ocean has no answer, and says so rather than guessing", () => {
    expect(reverseGeocode(0, -160)).toBeNull();
  });

  test("makes no network call — the index is a file on disk", () => {
    // If this ever needed the network it would need it here, in a test with
    // fetch removed. That is the whole promise of the bundled dataset.
    const original = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("ingest must not use the network");
    };
    try {
      expect(reverseGeocode(47.4647, 8.5492)?.countryCode).toBe("CH");
    } finally {
      globalThis.fetch = original;
    }
  });
});
