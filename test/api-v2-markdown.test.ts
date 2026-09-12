// B1596: the pure day/trip ⇄ markdown mapping. Since the owner allowed a
// breaking change to the on-disk format (only content/example/ needs
// converting, and that is the replay migration's job, later), the rule
// tested here is the plain one — a day's frontmatter IS `dayDoc` minus
// `slug`/`content`, plus the server-derived media extras; a trip's three
// files ARE its three wire sections. The one thing that has to be true is
// that round-tripping is lossless, and that no v1 key ever reappears.
import { describe, expect, it } from "vitest";
import matter from "gray-matter";
import {
  dayFromMarkdown,
  dayToMarkdown,
  tripFromMarkdown,
  tripToMarkdown,
  type DayFile,
  type TripFile,
} from "../lib/api/v2/markdown";

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

describe("dayToMarkdown / dayFromMarkdown", () => {
  it("round-trips a maximal day losslessly", () => {
    const raw = dayToMarkdown(maximalDay);
    expect(dayFromMarkdown(maximalDay.slug, raw)).toEqual(maximalDay);
  });

  it("round-trips a minimal, fully-declined day losslessly", () => {
    const raw = dayToMarkdown(minimalDay);
    expect(dayFromMarkdown(minimalDay.slug, raw)).toEqual(minimalDay);
  });

  it("round-trips a published day's status", () => {
    const day: DayFile = { ...minimalDay, status: "published" };
    expect(dayFromMarkdown(day.slug, dayToMarkdown(day)).status).toBe("published");
  });

  it("round-trips a draft day's status", () => {
    const day: DayFile = { ...minimalDay, status: "draft" };
    expect(dayFromMarkdown(day.slug, dayToMarkdown(day)).status).toBe("draft");
  });

  describe("weather, all four states", () => {
    it("absent: no weather key at all", () => {
      const raw = dayToMarkdown(minimalDay);
      expect(raw).not.toMatch(/^weather:/m);
      expect(dayFromMarkdown(minimalDay.slug, raw).weather).toBeUndefined();
    });

    it("asked, unanswered: weather: true", () => {
      const day: DayFile = { ...minimalDay, declined: undefined, weather: true };
      const raw = dayToMarkdown(day);
      expect(raw).toMatch(/^weather: true$/m);
      expect(dayFromMarkdown(day.slug, raw).weather).toBe(true);
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
      const raw = dayToMarkdown(day);
      expect(dayFromMarkdown(day.slug, raw)).toEqual(day);
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
      const raw = dayToMarkdown(day);
      expect(raw).toContain("open-meteo");
      expect(raw).not.toMatch(/^weatherData:/m);
      expect(dayFromMarkdown(day.slug, raw)).toEqual(day);
    });
  });

  it("emission is deterministic", () => {
    expect(dayToMarkdown(maximalDay)).toBe(dayToMarkdown(maximalDay));
  });

  it("is the wire's own key names — no v1 key ever emitted", () => {
    const raw = dayToMarkdown(maximalDay);
    expect(raw).not.toMatch(/^lat:/m);
    expect(raw).not.toMatch(/^lng:/m);
    expect(raw).not.toMatch(/^gallery:/m);
    expect(raw).not.toMatch(/^draft:/m);
    expect(raw).not.toMatch(/^weatherData:/m);
    expect(raw).not.toMatch(/^transport:/m);
    expect(raw).not.toMatch(/^without:/m);
    expect(raw).not.toMatch(/^unrecorded:/m);
  });

  it("ignores a pre-v2 file's retired decline keys rather than reviving them", () => {
    const raw = matter.stringify("Nothing recorded.", {
      title: "Old day",
      date: "2024-01-01",
      without: ["costs"],
      unrecorded: ["costs"],
      costs: false,
      draft: true,
    });
    const back = dayFromMarkdown("2024-01-01-old-day", raw);
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
    const raw = matter.stringify("Half a day.", {
      title: "Odd day",
      date: "2024-01-02",
      status: "publised",
    });
    expect(dayFromMarkdown("2024-01-02-odd-day", raw).status).toBe("draft");
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

describe("tripToMarkdown / tripFromMarkdown", () => {
  it("round-trips a maximal trip losslessly, across all three files", () => {
    const files = tripToMarkdown(maximalTrip);
    expect(Object.keys(files).sort()).toEqual(["costs.md", "plan.md", "trip.md"]);
    expect(tripFromMarkdown(files)).toEqual(maximalTrip);
  });

  it("round-trips a minimal, fully-declined trip — no costs.md, no plan.md", () => {
    const files = tripToMarkdown(minimalTrip);
    expect(files["costs.md"]).toBeUndefined();
    expect(files["plan.md"]).toBeUndefined();
    expect(tripFromMarkdown(files)).toEqual(minimalTrip);
  });

  it("emission is deterministic", () => {
    expect(tripToMarkdown(maximalTrip)).toEqual(tripToMarkdown(maximalTrip));
  });

  it("trip.md carries none of v1's retired keys", () => {
    const raw = tripToMarkdown(maximalTrip)["trip.md"];
    expect(raw).not.toMatch(/^start:/m);
    expect(raw).not.toMatch(/^end:/m);
    expect(raw).not.toMatch(/^status:/m);
    expect(raw).not.toMatch(/^tracks:/m);
    expect(raw).not.toMatch(/^travellers:/m);
    expect(raw).not.toMatch(/^costsVisibility:/m);
  });

  it("costs.visibility lives in costs.md, not on trip.md", () => {
    const files = tripToMarkdown(maximalTrip);
    expect(files["trip.md"]).not.toMatch(/^visibility: "?guests"?/m);
    expect(files["costs.md"]).toMatch(/visibility: guests/);
  });

  it("hostile strings survive intact (quotes, newlines, colons, a leading dash, unicode)", () => {
    const files = tripToMarkdown(maximalTrip);
    const back = tripFromMarkdown(files);
    expect(back.title).toBe(HOSTILE);
    expect(back.tagline).toBe(HOSTILE);
  });

  it("parses with gray-matter's own matter()", () => {
    const files = tripToMarkdown(maximalTrip);
    const { data, content } = matter(files["trip.md"]);
    expect(data.id).toBe("alps-2026");
    expect(data.dates).toEqual({ from: "2026-09-20", to: "2026-09-27" });
    expect(data.rates).toEqual({ currencies: ["CHF", "EUR", "VND"], manual: { VND: 30500 } });
    expect(content.trim()).toBe(maximalTrip.intro);

    const costs = matter(files["costs.md"]!);
    expect(costs.data.budget).toEqual(maximalTrip.costs!.budget);
    expect(costs.content.trim()).toBe(maximalTrip.costs!.note);

    const plan = matter(files["plan.md"]!);
    expect(plan.data.route).toEqual(maximalTrip.plan!.route);
    expect(plan.content.trim()).toBe(maximalTrip.plan!.body);
  });
});
