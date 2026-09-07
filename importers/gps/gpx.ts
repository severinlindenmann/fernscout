import { isSaneFix, parseInstant, type Fix, type GpsImporter } from "./schema";

/**
 * GPX — what every logger app, watch and handheld unit can export.
 *
 * Read with a regular expression rather than an XML parser, on purpose: the
 * subset that matters is `<trkpt lat lon>` with an optional `<time>`, the
 * files are machine-written, and a dependency for four capture groups is a
 * dependency to keep updated forever. If somebody turns up with a GPX this
 * cannot read, that is the day to reach for a parser.
 *
 * A point with no `<time>` is skipped rather than guessed at. The store is
 * ordered by time and a trip is clipped by time, so a fix that does not know
 * when it happened has nowhere to go.
 */
const POINT = /<(?:trkpt|rtept|wpt)\b[^>]*\blat="([^"]+)"[^>]*\blon="([^"]+)"[^>]*>([\s\S]*?)<\/(?:trkpt|rtept|wpt)>/gi;
const TIME = /<time>([^<]+)<\/time>/i;

const importer: GpsImporter = {
  id: "gpx",
  label: "GPX track (Garmin, Strava, GPSLogger, OsmAnd, …)",

  detect(head, filename) {
    return /\.gpx$/i.test(filename) || head.includes("<gpx");
  },

  parse(text) {
    const out: Fix[] = [];
    for (const match of text.matchAll(POINT)) {
      const t = parseInstant(TIME.exec(match[3])?.[1]);
      if (t === undefined) continue;
      const fix: Fix = { t, lat: Number(match[1]), lon: Number(match[2]) };
      if (isSaneFix(fix)) out.push(fix);
    }
    if (out.length === 0 && !text.includes("<gpx")) throw new Error("not a GPX file");
    return out;
  },
};

export default importer;
