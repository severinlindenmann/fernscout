import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { clearMatterCache, forgetEntries, getAllEntries } from "@/lib/entries";
import { createDraft } from "@/lib/api/entries";
import { fillDayWeather } from "@/lib/api/weather";
import { validateEntry, validateEntryEdit } from "@/lib/validate/entry";
import { fetchDayWeather } from "@/lib/weatherFetch";
import { parseWeather, weatherGroup, weatherLine } from "@/lib/weather";

/**
 * B325 — what the weather actually was.
 *
 * The tests that matter here are not the ones about parsing a number. They
 * are the ones in "the line this rests on": this project's rule is that an
 * agent invents no weather, and the only thing that makes a *measurement*
 * compatible with that rule is that it names its source. Anything that lets a
 * caller assert a reading without provenance, or borrow the archive's name for
 * something it believes, defeats the whole feature — so those are checked
 * first and hardest.
 */

let dir: string;
const ref = "ana/alps";

function writeInstance() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout", url: "https://example.test", defaultUser: "ana" },
      users: { reserved: [] },
      // The server is the ceiling and the journal opts in inside it, so both
      // halves have to say yes — see `resolveOne` in lib/capabilities.ts.
      features: { weather: { enabled: true } },
    }),
  );
}

function writeJournal(weatherOn: boolean) {
  fs.mkdirSync(path.join(dir, "ana", "trips", "alps", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "ana", "config.json"),
    JSON.stringify({
      title: "Ana's journal",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { weather: { enabled: weatherOn } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "ana", "trips", "alps", "trip.md"),
    [
      "---",
      'id: "alps"',
      'title: "Alps"',
      'start: "2026-08-20"',
      'end: "2026-09-10"',
      'status: "current"',
      'visibility: "public"',
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  clearConfigCache();
  clearUserCache();
  clearMatterCache();
  forgetEntries(ref);
}

function writeDay(frontmatter: string[]) {
  const file = path.join(dir, "ana", "trips", "alps", "entries", "2026-08-26-hoi-an.md");
  fs.writeFileSync(file, ["---", ...frontmatter, "---", "", "The prose.", ""].join("\n"));
  clearMatterCache();
  forgetEntries(ref);
  return file;
}

/** One Open-Meteo answer, in the shape both of its endpoints return. */
function providerAnswer(daily: Record<string, unknown[]>) {
  return {
    ok: true,
    json: async () => ({ daily: { time: ["2026-08-26"], ...daily } }),
  } as unknown as Response;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-weather-"));
  process.env.CONTENT_DIR = dir;
  writeInstance();
  writeJournal(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the line this rests on: a caller cannot assert weather", () => {
  const day = {
    title: "Hoi An",
    date: "2026-08-26",
    content: "The prose.",
  };

  test("a reading with no provenance is refused, not quietly dropped", () => {
    const problems = validateEntry({ ...day, weatherData: { tempMax: 24 } });
    expect(problems.map((p) => p.field)).toEqual(
      expect.arrayContaining(["weatherData.source", "weatherData.recordedAt"]),
    );
  });

  test("no caller may claim the archive's own name as a source", () => {
    for (const source of ["open-meteo", "Open-Meteo", "  OPEN-METEO  "]) {
      const problems = validateEntry({
        ...day,
        weatherData: { tempMax: 24, source, recordedAt: "2026-08-26T17:00:00Z" },
      });
      expect(
        problems.filter((p) => p.field === "weatherData.source"),
        `"${source}" was accepted`,
      ).toHaveLength(1);
    }
  });

  test("the same rule applies to an edit, not only to creation", () => {
    const problems = validateEntryEdit({
      weatherData: { tempMax: 24, source: "open-meteo", recordedAt: "2026-08-26T17:00:00Z" },
    });
    expect(problems.map((p) => p.field)).toContain("weatherData.source");
  });

  test("a named source with a real measurement is accepted", () => {
    const problems = validateEntry({
      ...day,
      weatherData: {
        tempMax: 24,
        precipitation: 3,
        source: "the thermometer on the balcony",
        recordedAt: "2026-08-26T17:00:00Z",
      },
    });
    expect(problems).toEqual([]);
  });

  test("provenance with nothing measured is a claim about nothing", () => {
    const problems = validateEntry({
      ...day,
      weatherData: { source: "my own eyes", recordedAt: "2026-08-26T17:00:00Z" },
    });
    expect(problems.map((p) => p.field)).toContain("weatherData");
  });

  test("weather: true is a request and must be a real boolean", () => {
    expect(validateEntry({ ...day, weather: true })).toEqual([]);
    expect(validateEntry({ ...day, weather: "true" }).map((p) => p.field)).toContain("weather");
  });

  test("a value outside what any day has ever been is refused", () => {
    const problems = validateEntry({
      ...day,
      weatherData: { tempMax: 400, source: "a broken sensor", recordedAt: "2026-08-26T17:00:00Z" },
    });
    expect(problems.map((p) => p.field)).toContain("weatherData.tempMax");
  });

  test("a source that could close its own YAML value is refused", () => {
    const problems = validateEntry({
      ...day,
      weatherData: {
        tempMax: 24,
        source: 'a "station"\n---\nstatus: published',
        recordedAt: "2026-08-26T17:00:00Z",
      },
    });
    expect(problems.map((p) => p.field)).toContain("weatherData.source");
  });
});

describe("the capability is off", () => {
  test("no request is made to anybody, and nothing is written", async () => {
    writeJournal(false);
    const file = writeDay(['title: "Hoi An"', 'date: "2026-08-26"', "weather: true", "lat: 15.88", "lng: 108.34"]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(await fillDayWeather(ref, "hoi-an")).toBe("capability_off");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, "utf8")).not.toContain("weatherData");
  });

  test("and nothing is rendered — the day carries no reading at all", () => {
    writeJournal(false);
    writeDay(['title: "Hoi An"', 'date: "2026-08-26"', "weather: true", "lat: 15.88", "lng: 108.34"]);
    expect(getAllEntries(ref)[0].weather).toBeUndefined();
  });
});

describe("filling a day in", () => {
  test("a day that asked, with coordinates, gets a reading naming its source", async () => {
    const file = writeDay(['title: "Hoi An"', 'date: "2026-08-26"', "weather: true", "lat: 15.88", "lng: 108.34"]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      providerAnswer({
        weather_code: [53],
        temperature_2m_max: [39.4],
        temperature_2m_min: [30.2],
        precipitation_sum: [2.7],
        wind_speed_10m_max: [22.9],
      }),
    );

    expect(await fillDayWeather(ref, "hoi-an")).toBe("filled");

    const written = fs.readFileSync(file, "utf8");
    expect(written).toContain('source: "open-meteo"');
    // The prose and the fields the author wrote survive a lookup untouched.
    expect(written).toContain("The prose.");
    expect(written).toContain('title: "Hoi An"');

    const entry = getAllEntries(ref, { includeDrafts: true })[0];
    expect(entry.weather?.tempMax).toBe(39.4);
    expect(entry.weather?.source).toBe("open-meteo");
    expect(entry.weather?.recordedAt).toBeTruthy();
  });

  test("a day with no coordinates gets nothing — not a guess from anywhere", async () => {
    writeDay(['title: "Hoi An"', 'date: "2026-08-26"', "weather: true"]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await fillDayWeather(ref, "hoi-an")).toBe("no_coordinates");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a day that never asked is left alone", async () => {
    writeDay(['title: "Hoi An"', 'date: "2026-08-26"', "lat: 15.88", "lng: 108.34"]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await fillDayWeather(ref, "hoi-an")).toBe("not_asked");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a reading the author recorded is never overwritten by a lookup", async () => {
    const file = writeDay([
      'title: "Hoi An"',
      'date: "2026-08-26"',
      "weather: true",
      "lat: 15.88",
      "lng: 108.34",
      'weatherData: { tempMax: 24, source: "the balcony thermometer", recordedAt: "2026-08-26T17:00:00Z" }',
    ]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(await fillDayWeather(ref, "hoi-an")).toBe("already_recorded");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, "utf8")).toContain("the balcony thermometer");
  });

  test("a dry run stops before the network and reports what it would do", async () => {
    writeDay(['title: "Hoi An"', 'date: "2026-08-26"', "weather: true", "lat: 15.88", "lng: 108.34"]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await fillDayWeather(ref, "hoi-an", { dryRun: true })).toBe("would_fetch");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a provider that answers with nothing leaves the day for next time", async () => {
    const file = writeDay(['title: "Hoi An"', 'date: "2026-08-26"', "weather: true", "lat: 15.88", "lng: 108.34"]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      providerAnswer({ weather_code: [null], temperature_2m_max: [null], temperature_2m_min: [null] }),
    );
    expect(await fillDayWeather(ref, "hoi-an")).toBe("no_answer");
    expect(fs.readFileSync(file, "utf8")).not.toContain("weatherData");
  });

  test("a refusal from the provider is not an error anybody hears about", async () => {
    writeDay(['title: "Hoi An"', 'date: "2026-08-26"', "weather: true", "lat: 15.88", "lng: 108.34"]);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(fillDayWeather(ref, "hoi-an")).resolves.toBe("no_answer");
  });

  test("a written day carries the request into its own frontmatter", () => {
    const result = createDraft(ref, {
      title: "Da Lat",
      date: "2026-08-27",
      content: "The prose.",
      lat: 11.94,
      lng: 108.44,
      weather: true,
    });
    expect(result.ok).toBe(true);
    const written = fs.readFileSync(
      path.join(dir, "ana", "trips", "alps", "entries", "2026-08-27-da-lat.md"),
      "utf8",
    );
    expect(written).toContain("weather: true");
    expect(written).toContain("status: draft");
  });
});

describe("which endpoint, and what comes back", () => {
  const url = () => (vi.mocked(globalThis.fetch).mock.calls[0][0] as URL).toString();

  test("a day from last week goes to the forecast endpoint, which covers it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(providerAnswer({ temperature_2m_max: [21] }));
    await fetchDayWeather(15.88, 108.34, "2026-08-26", { now: new Date("2026-08-28T10:00:00Z") });
    expect(url()).toContain("api.open-meteo.com/v1/forecast");
  });

  test("an older day goes to the archive", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(providerAnswer({ temperature_2m_max: [21] }));
    await fetchDayWeather(15.88, 108.34, "2026-08-26", { now: new Date("2026-09-30T10:00:00Z") });
    expect(url()).toContain("archive-api.open-meteo.com/v1/archive");
  });

  test("a day in the future is not asked about at all", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const answer = await fetchDayWeather(15.88, 108.34, "2026-12-24", {
      now: new Date("2026-08-28T10:00:00Z"),
    });
    expect(answer).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("an answer about a different day is not this day's weather", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ daily: { time: ["2026-08-25"], temperature_2m_max: [21] } }),
    } as unknown as Response);
    await expect(
      fetchDayWeather(15.88, 108.34, "2026-08-26", { now: new Date("2026-08-28T10:00:00Z") }),
    ).resolves.toBeUndefined();
  });
});

describe("reading one back", () => {
  test("a reading with no source or no timestamp reads as absent", () => {
    expect(parseWeather({ tempMax: 24, recordedAt: "2026-08-26T17:00:00Z" })).toBeUndefined();
    expect(parseWeather({ tempMax: 24, source: "a station" })).toBeUndefined();
    expect(parseWeather({ source: "a station", recordedAt: "2026-08-26T17:00:00Z" })).toBeUndefined();
    expect(parseWeather(undefined)).toBeUndefined();
  });

  test("a hand-edited file the API would have refused does not render", () => {
    writeDay([
      'title: "Hoi An"',
      'date: "2026-08-26"',
      "weatherData: { tempMax: 24 }",
    ]);
    expect(getAllEntries(ref, { includeDrafts: true })[0].weather).toBeUndefined();
  });

  test("what is written is what reads back", () => {
    const reading = {
      tempMin: 30.2,
      tempMax: 39.4,
      code: 53,
      precipitation: 2.7,
      windMax: 22.9,
      source: "open-meteo",
      recordedAt: "2026-09-06T09:14:00.000Z",
    };
    // Round-tripped through the file, not through a string compare: what
    // matters is that gray-matter parses back exactly what was written.
    writeDay(['title: "Hoi An"', 'date: "2026-08-26"', weatherLine(reading)]);
    expect(getAllEntries(ref, { includeDrafts: true })[0].weather).toEqual(reading);
  });

  test("an unrecognised WMO code draws no glyph rather than the wrong one", () => {
    expect(weatherGroup(0)).toBe("clear");
    expect(weatherGroup(53)).toBe("rain");
    expect(weatherGroup(73)).toBe("snow");
    expect(weatherGroup(96)).toBe("thunder");
    expect(weatherGroup(4)).toBeUndefined();
    expect(weatherGroup(undefined)).toBeUndefined();
  });
});
