// B1596/B1606: the pure day/trip ⇄ JSON mapping. Since the owner allowed a
// breaking change to the on-disk format (only content/example/ needs
// converting, and that is the replay migration's job, later), the rule
// tested here is the plain one — a day's file IS `dayDoc` minus `slug`, plus
// the server-derived media extras; a trip's one file IS its whole wire
// document, `costs` and `plan` included. The one thing that has to be true
// is that round-tripping is lossless, and that no v1 key ever reappears.
import { describe, expect, it } from "vitest";
import {
  dayFromJson,
  dayToJson,
  tripFromJson,
  tripToJson,
  type DayFile,
  type TripFile,
} from "../lib/api/v2/documents";

const HOSTILE = 'a "quoted" title\nwith a newline: and a colon\n- and a leading dash\nünïcödé too';

const maximalDay: DayFile = {
  slug: "2026-09-12-over-the-susten",
  title: HOSTILE,
  date: "2026-09-12",
  time: "14:30",
  timezone: "Europe/Zurich",
  content: "We left late.\n\nAt the top there was soup.",
  location: "Susten Pass",
  country: "Switzerland",
  countryCode: "CH",
  coordinates: { lat: 46.7297, lng: 8.4444 },
  transportMode: "car",
  transportFrom: "Zurich",
  transportTo: "Susten Pass",
  translations: {
    de: { title: "Über den Susten", content: "Wir sind spät losgefahren." },
  },
  visibility: "guest",
  travelScene: "default",
  test: true,
  media: [
    {
      src: "/media/alps-2026/susten/01.jpg",
      type: "image",
      width: 1600,
      height: 1067,
      caption: HOSTILE,
    },
    {
      src: "/media/alps-2026/susten/02.jpg",
      type: "video",
      width: 1067,
      height: 1600,
      poster: "/media/alps-2026/susten/02-poster.jpg",
      visibility: "private",
    },
  ],
  costs: [
    { label: "Fuel", amount: 78, category: "transport" },
    { label: "Lunch at the pass", amount: 46, category: "food", currency: "EUR" },
  ],
  declined: {
    tags: "no tags chosen for this one",
  },
  status: "draft",
  weather: true,
};

const minimalDay: DayFile = {
  slug: "2026-09-13-a-rest-day",
  title: "A rest day",
  date: "2026-09-13",
  content: "",
  status: "published",
  declined: {
    media: "nothing photographed today (rest day)",
    costs: "nothing spent",
    coordinates: "not tracked",
    weather: "declined for now",
    time: "not recorded",
    timezone: "not recorded",
    location: "not recorded",
    country: "not recorded",
    countryCode: "not recorded",
    transportMode: "a rest day, no leg",
    tags: "none chosen",
    translations: "single-language journal",
    visibility: "shown to everyone the trip lets in",
    status: "not a draft",
  },
};

describe("dayToJson / dayFromJson", () => {
  it("round-trips a maximal day losslessly", () => {
    const raw = dayToJson(maximalDay);
    expect(dayFromJson(maximalDay.slug, raw)).toEqual(maximalDay);
  });

  it("round-trips a minimal, fully-declined day losslessly", () => {
    const raw = dayToJson(minimalDay);
    expect(dayFromJson(minimalDay.slug, raw)).toEqual(minimalDay);
  });

  it("round-trips a published day's status", () => {
    const day: DayFile = { ...minimalDay, status: "published" };
    expect(dayFromJson(day.slug, dayToJson(day)).status).toBe("published");
  });

  it("round-trips a draft day's status", () => {
    const day: DayFile = { ...minimalDay, status: "draft" };
    expect(dayFromJson(day.slug, dayToJson(day)).status).toBe("draft");
  });

  describe("weather, all four states", () => {
    it("absent: no weather key at all", () => {
      const raw = dayToJson(minimalDay);
      expect(JSON.parse(raw)).not.toHaveProperty("weather");
      expect(dayFromJson(minimalDay.slug, raw).weather).toBeUndefined();
    });

    it("asked, unanswered: weather: true", () => {
      const day: DayFile = { ...minimalDay, declined: undefined, weather: true };
      const raw = dayToJson(day);
      expect(JSON.parse(raw).weather).toBe(true);
      expect(dayFromJson(day.slug, raw).weather).toBe(true);
    });

    it("a caller's own reading", () => {
      const day: DayFile = {
        ...minimalDay,
        declined: undefined,
        weather: {
          tempMin: 10,
          tempMax: 18,
          source: "my own weather station",
          recordedAt: "2026-09-13T06:00:00Z",
        },
      };
      const raw = dayToJson(day);
      expect(dayFromJson(day.slug, raw)).toEqual(day);
    });

    it("the server's own reading — a reading whose source is open-meteo, nothing else", () => {
      const day: DayFile = {
        ...minimalDay,
        declined: undefined,
        weather: {
          tempMin: -4.7,
          tempMax: -1.3,
          code: 75,
          precipitation: 6.9,
          windMax: 9.2,
          source: "open-meteo",
          recordedAt: "2026-09-06T08:32:19.875Z",
        },
      };
      const raw = dayToJson(day);
      expect(raw).toContain("open-meteo");
      expect(JSON.parse(raw)).not.toHaveProperty("weatherData");
      expect(dayFromJson(day.slug, raw)).toEqual(day);
    });
  });

  it("emission is deterministic", () => {
    expect(dayToJson(maximalDay)).toBe(dayToJson(maximalDay));
  });

  it("is the wire's own key names — no v1 key ever emitted, and no slug key at all", () => {
    const raw = dayToJson(maximalDay);
    const data = JSON.parse(raw);
    expect(data).not.toHaveProperty("lat");
    expect(data).not.toHaveProperty("lng");
    expect(data).not.toHaveProperty("gallery");
    expect(data).not.toHaveProperty("draft");
    expect(data).not.toHaveProperty("weatherData");
    expect(data).not.toHaveProperty("transport");
    expect(data).not.toHaveProperty("without");
    expect(data).not.toHaveProperty("unrecorded");
    expect(data).not.toHaveProperty("slug");
  });

  it("ignores a pre-v2 file's retired decline keys rather than reviving them", () => {
    const raw = JSON.stringify({
      title: "Old day",
      date: "2024-01-01",
      content: "Nothing recorded.",
      without: ["costs"],
      unrecorded: ["costs"],
      costs: false,
      draft: true,
    });
    const back = dayFromJson("2024-01-01-old-day", raw);
    expect(back.costs).toBeUndefined();
    expect("without" in back).toBe(false);
    expect("unrecorded" in back).toBe(false);
    // v1's `draft: true` is not read — but the absence of `status:` falls to
    // "draft", never to "published". This day IS a v1 draft, and the failure
    // has to land on the side of not putting something on the site: a file
    // this serializer cannot read confidently must not become a published
    // page. The replay migrator is what translates `draft: true` properly.
    expect(back.status).toBe("draft");
  });

  it("reads an unrecognised status as a draft rather than publishing it", () => {
    const raw = JSON.stringify({
      title: "Odd day",
      date: "2024-01-02",
      content: "Half a day.",
      status: "publised",
    });
    expect(dayFromJson("2024-01-02-odd-day", raw).status).toBe("draft");
  });

  it("a file that is not valid JSON fails loudly rather than becoming an empty document", () => {
    expect(() => dayFromJson("2024-01-03-broken", "{ not json")).toThrow();
  });

  it("prunes an undefined property nested inside an object and inside an array element, without a manual pruner (B1601 no longer applies)", () => {
    // JSON.stringify drops an undefined object property on its own — no
    // recursive pruneUndefined() is needed the way matter.stringify needed
    // one, because JSON.stringify was always built to handle this rather
    // than throwing on it. An undefined array element is the one exception:
    // JSON.stringify turns it into null rather than dropping the slot (the
    // array still has that many slots, which is a different fact from an
    // absent property), same choice the old pruner made for the same case.
    const day: DayFile = {
      ...minimalDay,
      declined: undefined,
      costs: [{ label: "Fuel", amount: 10, category: undefined }],
    };
    expect(() => dayToJson(day)).not.toThrow();
    expect(JSON.parse(dayToJson(day))).not.toHaveProperty("declined");
    const back = dayFromJson(day.slug, dayToJson(day));
    expect(back.costs).toEqual([{ label: "Fuel", amount: 10 }]);
  });

  describe("content that would have been hostile to YAML frontmatter — plain JSON strings now, kept anyway (B1601)", () => {
    // These used to matter because gray-matter's stringify() re-parsed the
    // body for a frontmatter delimiter of its own, or because YAML coerces
    // bare scalars. Neither applies to a JSON string, which is quoted once
    // and never re-parsed for structure — but the underlying worry (this
    // content reaches a person, and must survive byte-for-byte) is still
    // real, so the cases stay.
    it.each([
      ["exactly ---", "---"],
      ["--- then a line", "---\nthis looks like frontmatter\n---\nmore"],
      ["the bare word null", "null"],
      ["digits that look numeric but must stay a string", "0123"],
    ])("day content: %s", (_label, content) => {
      const day: DayFile = { ...minimalDay, content };
      expect(dayFromJson(day.slug, dayToJson(day)).content).toBe(content);
    });

    it("a caption of digits that look numeric stays a string", () => {
      const day: DayFile = {
        ...minimalDay,
        declined: undefined,
        media: [{ src: "/media/x.jpg", type: "image", caption: "0123" }],
      };
      const back = dayFromJson(day.slug, dayToJson(day));
      expect(back.media?.[0]?.caption).toBe("0123");
    });

    it("a hostile string in a title and in a decline reason survives intact", () => {
      const day: DayFile = { ...maximalDay, declined: { tags: HOSTILE } };
      const back = dayFromJson(day.slug, dayToJson(day));
      expect(back.title).toBe(HOSTILE);
      expect(back.declined?.tags).toBe(HOSTILE);
    });

    it("trip intro: content that would have looked like frontmatter", () => {
      const trip: TripFile = { ...minimalTrip, intro: "---\nthis looks like frontmatter\n---\nmore" };
      expect(tripFromJson(tripToJson(trip)).intro).toBe(trip.intro);
    });
  });
});

const maximalTrip: TripFile = {
  id: "alps-2026",
  title: HOSTILE,
  dates: { from: "2026-09-20", to: "2026-09-27" },
  visibility: "guest",
  teaser: false,
  people: [
    { name: "Example Owner", email: "owner@example.com" },
    { name: "A Buddy", email: "buddy@example.com" },
  ],
  rates: { currencies: ["CHF", "EUR", "VND"], manual: { VND: 30500 } },
  costs: {
    budget: { total: 1800, days: 8, currency: "CHF" },
    items: [{ label: "Roof box hire", amount: 60, category: "preparation" }],
    note: "Booked the roof box a month early: colon here.",
    visibility: "guests",
  },
  plan: {
    route: [{ location: "Grindelwald", lat: 46.62, lng: 8.03, country: "Switzerland", countryCode: "CH" }],
    body: "Three passes and whatever was between them.",
  },
  accent: "green",
  cover: "/media/alps-2026/susten/01.jpg",
  tagline: HOSTILE,
  intro: "A week on the narrow-gauge lines.\n\nAnd a colon: right there.",
  translations: {
    de: { title: "Alpen mit der Bahn", tagline: "Sechs Pässe in sieben Tagen", intro: "Eine Woche." },
  },
  figures: { mode: "custom", figures: ["anna", "ben"] },
  test: true,
  declined: {
    listed: "closed trip, nothing to list",
  },
};

const minimalTrip: TripFile = {
  id: "rest-week",
  title: "A quiet week",
  dates: { from: "2026-10-01", to: "2026-10-07" },
  visibility: "private",
  teaser: true,
  people: [{ name: "Example Owner", email: "owner@example.com" }],
  declined: {
    rates: "no money changed hands",
    costs: "nothing tracked here",
    plan: "nothing planned in advance",
    days: "not started yet",
    translations: "single-language journal",
    accent: "default is fine",
    cover: "no photos yet",
    figures: "not drawn",
    tagline: "no subtitle",
    intro: "nothing to say yet",
    buddies: "travelling solo",
  },
};

describe("tripToJson / tripFromJson", () => {
  it("round-trips a maximal trip losslessly, as one file", () => {
    const raw = tripToJson(maximalTrip);
    expect(tripFromJson(raw)).toEqual(maximalTrip);
  });

  it("round-trips a minimal, fully-declined trip — no costs key, no plan key", () => {
    const raw = tripToJson(minimalTrip);
    const data = JSON.parse(raw);
    expect(data).not.toHaveProperty("costs");
    expect(data).not.toHaveProperty("plan");
    expect(tripFromJson(raw)).toEqual(minimalTrip);
  });

  it("emission is deterministic", () => {
    expect(tripToJson(maximalTrip)).toBe(tripToJson(maximalTrip));
  });

  it("carries none of v1's retired keys", () => {
    const data = JSON.parse(tripToJson(maximalTrip));
    expect(data).not.toHaveProperty("start");
    expect(data).not.toHaveProperty("end");
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("tracks");
    expect(data).not.toHaveProperty("travellers");
    expect(data).not.toHaveProperty("costsVisibility");
  });

  it("costs.visibility lives inside costs, not on the trip itself", () => {
    const data = JSON.parse(tripToJson(maximalTrip));
    expect(data).not.toHaveProperty("visibility", "guests");
    expect(data.costs.visibility).toBe("guests");
  });

  it("hostile strings survive intact (quotes, newlines, colons, a leading dash, unicode)", () => {
    const back = tripFromJson(tripToJson(maximalTrip));
    expect(back.title).toBe(HOSTILE);
    expect(back.tagline).toBe(HOSTILE);
  });

  it("a file that is not valid JSON fails loudly rather than becoming an empty document", () => {
    expect(() => tripFromJson("{ not json")).toThrow();
  });

  it("parses with JSON.parse", () => {
    const raw = tripToJson(maximalTrip);
    const data = JSON.parse(raw);
    expect(data.id).toBe("alps-2026");
    expect(data.dates).toEqual({ from: "2026-09-20", to: "2026-09-27" });
    expect(data.rates).toEqual({ currencies: ["CHF", "EUR", "VND"], manual: { VND: 30500 } });
    expect(data.intro).toBe(maximalTrip.intro);
    expect(data.costs.budget).toEqual(maximalTrip.costs!.budget);
    expect(data.costs.note).toBe(maximalTrip.costs!.note);
    expect(data.plan.route).toEqual(maximalTrip.plan!.route);
    expect(data.plan.body).toBe(maximalTrip.plan!.body);
  });
});
