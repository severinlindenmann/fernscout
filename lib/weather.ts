/**
 * What the weather actually was — B325.
 *
 * Pure on purpose, the same discipline as lib/validate/entry.ts: no fs, no
 * `server-only`, no network. That is what lets the validator, the frontmatter
 * writer, the refresh script and the browser component all share one reading
 * of a WMO code instead of four that drift. The fetch itself lives in
 * lib/weatherFetch.ts, which is the half that talks to a third party.
 *
 * The rule this module exists to hold: **a reading is nothing without its
 * provenance.** `source` and `recordedAt` are required on the type, not
 * optional, so there is no shape in which a number reaches a page without
 * saying where it came from and when it was true.
 */

/**
 * One day's weather, as stored in the day's own frontmatter and rendered.
 *
 * The measurements are all optional because a source may not carry all of
 * them and a person recording their own reading will rarely carry any but
 * one. The provenance is not.
 */
export type DayWeather = {
  /** °C. */
  tempMin?: number;
  /** °C. */
  tempMax?: number;
  /** WMO weather interpretation code — see `weatherGroup`. */
  code?: number;
  /** mm over the day. */
  precipitation?: number;
  /** km/h, the day's maximum. */
  windMax?: number;
  /**
   * Where this came from. `open-meteo` is the server's own and a caller may
   * never claim it — see `RESERVED_SOURCES`. Anything else is what the person
   * supplying the reading called it, and it is what the page credits.
   */
  source: string;
  /**
   * When this was true, as an ISO instant. The fetch instant for a lookup;
   * when the reading was taken for a hand-supplied one. One field rather than
   * two, because it answers one question.
   */
  recordedAt: string;
};

/**
 * Sources only the server may write.
 *
 * The whole ticket rests on a reader being able to tell a measurement from
 * something an agent believed. An agent that could send
 * `source: "open-meteo"` alongside numbers it invented would erase that
 * distinction with one field, so the validator refuses these by name.
 */
export const RESERVED_SOURCES = ["open-meteo"] as const;

/**
 * How a reserved source is shown and credited.
 *
 * Two things a stored value cannot be: `open-meteo` is a machine name and
 * reads as one in the middle of a sentence, and Open-Meteo's data is CC BY —
 * attribution is a licence condition, not a courtesy, and a tooltip is not
 * attribution. So the credit is a link wherever the reading is drawn.
 *
 * A hand-supplied source has no entry here and is shown exactly as the person
 * wrote it, unlinked. That difference is deliberate and visible: a linked
 * credit means a measurement came from a public archive.
 */
export const SOURCE_CREDIT: Record<string, { label: string; href: string }> = {
  "open-meteo": { label: "Open-Meteo", href: "https://open-meteo.com/" },
};

/** The glyphs there are. One per group, and `weatherGroup` is total. */
const WEATHER_GROUPS = [
  "clear",
  "partly",
  "cloudy",
  "fog",
  "rain",
  "snow",
  "thunder",
] as const;

export type WeatherGroup = (typeof WEATHER_GROUPS)[number];

/**
 * A WMO interpretation code → the group we draw.
 *
 * The WMO table has around thirty values and seven glyphs is what a meta line
 * beside a date can carry. Drizzle, rain and showers are one group on purpose:
 * the distinction matters to a meteorologist and not to somebody reading back
 * a day in Hoi An.
 *
 * An unrecognised code — a provider that grows a value, or a hand-supplied
 * reading with a typo in it — returns undefined rather than a guess, and the
 * component then shows the reading with no glyph. A wrong picture is worse
 * than no picture.
 */
export function weatherGroup(code: number | undefined): WeatherGroup | undefined {
  if (code === undefined || !Number.isFinite(code)) return undefined;
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 67) return "rain";
  if (code >= 80 && code <= 82) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code === 85 || code === 86) return "snow";
  if (code >= 95 && code <= 99) return "thunder";
  return undefined;
}

/** Rounded the way it is shown: a journal is not a weather station. */
function round(n: number, places = 0): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** YAML and JSON both hand us real numbers, so anything else is not one. */
function numberOr(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/**
 * `weatherData:` read back off disk, or undefined.
 *
 * Undefined for anything missing its provenance, which is the same rule the
 * validator applies on the way in — a file edited by hand into a shape the
 * API would have refused must not render as though the API had accepted it.
 * Same spirit as `parseTravelSceneVariant` in lib/entries.ts: a value that
 * cannot be trusted reads as absent rather than throwing or drawing something
 * nobody asked for.
 */
export function parseWeather(raw: unknown): DayWeather | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const source = typeof src.source === "string" ? src.source.trim() : "";
  const recordedAt = typeof src.recordedAt === "string" ? src.recordedAt.trim() : "";
  if (!source || !recordedAt) return undefined;

  const out: DayWeather = { source, recordedAt };
  const tempMin = numberOr(src.tempMin);
  const tempMax = numberOr(src.tempMax);
  const code = numberOr(src.code);
  const precipitation = numberOr(src.precipitation);
  const windMax = numberOr(src.windMax);
  if (tempMin !== undefined) out.tempMin = round(tempMin, 1);
  if (tempMax !== undefined) out.tempMax = round(tempMax, 1);
  if (code !== undefined) out.code = code;
  if (precipitation !== undefined) out.precipitation = round(precipitation, 1);
  if (windMax !== undefined) out.windMax = round(windMax, 1);

  // A reading with provenance and no measurement is a claim about nothing.
  return hasMeasurement(out) ? out : undefined;
}

/** Whether a reading actually says anything about the weather. */
export function hasMeasurement(w: Partial<DayWeather>): boolean {
  return (
    w.tempMin !== undefined ||
    w.tempMax !== undefined ||
    w.code !== undefined ||
    w.precipitation !== undefined ||
    w.windMax !== undefined
  );
}

/**
 * `weatherData:` as the one frontmatter line it is written as.
 *
 * A YAML flow mapping rather than a nested block — see the plan document.
 * Every value here is a number or a string this module produced, so the only
 * quoting needed is the double quotes around the two strings; `source` is
 * bounded by the validator to characters that cannot close one.
 */
export function weatherLine(w: DayWeather): string {
  const parts: string[] = [];
  const put = (key: string, value: number | undefined) => {
    if (value !== undefined) parts.push(`${key}: ${value}`);
  };
  put("tempMin", w.tempMin);
  put("tempMax", w.tempMax);
  put("code", w.code);
  put("precipitation", w.precipitation);
  put("windMax", w.windMax);
  parts.push(`source: ${JSON.stringify(w.source)}`);
  parts.push(`recordedAt: ${JSON.stringify(w.recordedAt)}`);
  return `weatherData: { ${parts.join(", ")} }`;
}
