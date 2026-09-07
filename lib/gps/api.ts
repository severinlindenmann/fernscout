import { GPS_IMPORTERS } from "@/importers/gps";
import { checkGpsImporter, type GpsImporter } from "@/importers/gps/schema";
import { appendFixes, type AppendResult } from "./store";
import { readExcludeZones, trackForTrip } from "./enrich";
import { readTrack, trackPointCount, writeTrack } from "./track";

/**
 * What an API route may reach — B671.
 *
 * This is the only thing an API route is allowed to reach for. The route
 * authenticates, finds the bytes and answers; everything about *what an
 * import is* — which importer, whether it holds up, what goes on disk — is
 * here, so there is one answer to that question however the bytes arrived.
 *
 * **It writes and never reads.** There is no function in this file that hands
 * back a position, and there must not be: what the site draws is the derived
 * `track.json` (`./track.ts`), and a `GET` that returned fixes would undo the
 * whole shape B665 built. `test/gps-store.test.ts` asserts that no route
 * imports `./store` or `./enrich` directly, and this module is the reason it
 * still can.
 */

/**
 * The kinds of data that can be imported.
 *
 * One today. A bank export into a trip's costs would be `"costs"`, with its
 * own folder under `importers/`, its own row type and its own writer — the
 * same request shape with a different word, which is why the API takes a kind
 * at all rather than being called `/gps/import`.
 */
export const IMPORT_KINDS = ["gps"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export type ImportOutcome = {
  kind: ImportKind;
  /** The importer that read it — asked for, or detected. */
  format: string;
  detected: boolean;
  /** How many rows came out of the file, before thinning. */
  read: number;
  /** ISO dates of the first and last row, or null for an empty read. */
  from: string | null;
  to: string | null;
  /** Absent on a dry run: nothing was written. */
  stored?: AppendResult;
};

/** Neither an error nor an outcome: the file could not be read as anything. */
export type ImportRefusal = {
  refusal: "unknown_format" | "unreadable" | "contract";
  message: string;
  problems?: string[];
};

export function isRefusal(result: ImportOutcome | ImportRefusal): result is ImportRefusal {
  return "refusal" in result;
}

/** What `GET /api/v1/<user>/import` answers with, and what a caller needs
 * before they can make the `POST`. */
export function importFormats(): {
  kind: ImportKind;
  formats: { id: string; label: string }[];
}[] {
  return [
    { kind: "gps", formats: GPS_IMPORTERS.map((i) => ({ id: i.id, label: i.label })) },
  ];
}

/** How much of the file `detect` is shown — the same 64 kB the contract
 * promises, so an importer behaves identically whatever the door. */
const HEAD_CHARS = 64 * 1024;

/** How to name the file in a refusal. `inline` is the placeholder the route
 * gives pasted text, and telling somebody that nothing recognised "inline"
 * sends them looking for a file they never sent. */
function subject(filename: string): string {
  return filename === "inline" ? "the text you sent" : JSON.stringify(filename);
}

function chooseImporter(
  text: string,
  filename: string,
  format: string | undefined,
): { importer: GpsImporter; detected: boolean } | ImportRefusal {
  if (format !== undefined) {
    const named = GPS_IMPORTERS.find((i) => i.id === format);
    if (!named)
      return {
        refusal: "unknown_format",
        message:
          `No importer called ${JSON.stringify(format)}. ` +
          `Known formats: ${GPS_IMPORTERS.map((i) => i.id).join(", ")}. ` +
          "Leave `format` out and the file is recognised from its own contents.",
      };
    return { importer: named, detected: false };
  }
  const head = text.slice(0, HEAD_CHARS);
  const found = GPS_IMPORTERS.find((i) => i.detect(head, filename));
  if (!found)
    return {
      refusal: "unknown_format",
      message:
        `Nothing recognised ${subject(filename)}. Name the format explicitly — one of ` +
        `${GPS_IMPORTERS.map((i) => i.id).join(", ")} — or, if this came out of a tool of ` +
        "your own, print JSON Lines of `[t, lat, lon]` and send it as `fixes`.",
    };
  return { importer: found, detected: true };
}

/**
 * Read a file into the journal's store.
 *
 * `dryRun` parses, checks and reports without writing anything — the same
 * check `importers/gps/schema.ts` exports, so somebody testing an importer
 * they wrote gets told what is wrong in words rather than finding out from a
 * map of the Gulf of Guinea a week later.
 */
export function importGps(
  username: string,
  text: string,
  filename: string,
  options: { format?: string; dryRun?: boolean } = {},
): ImportOutcome | ImportRefusal {
  const chosen = chooseImporter(text, filename, options.format);
  if ("refusal" in chosen) return chosen;

  let rows;
  try {
    rows = chosen.importer.parse(text);
  } catch (error) {
    return {
      refusal: "unreadable",
      message:
        `${chosen.importer.id} could not read ${subject(filename)}: ` +
        `${(error as Error).message}. ` +
        (chosen.detected
          ? "It was chosen by looking at the file, so it may be the wrong one — name a format."
          : "It was the format you named; check that against the file."),
    };
  }

  const problems = checkGpsImporter(chosen.importer, rows);
  if (problems.length > 0)
    return {
      refusal: "contract",
      message: `${chosen.importer.id} read the file, and what came out does not hold up.`,
      problems,
    };

  const times = rows.map((r) => r.t);
  const outcome: ImportOutcome = {
    kind: "gps",
    format: chosen.importer.id,
    detected: chosen.detected,
    read: rows.length,
    from: new Date(Math.min(...times)).toISOString(),
    to: new Date(Math.max(...times)).toISOString(),
  };
  if (options.dryRun) return outcome;
  return { ...outcome, stored: appendFixes(username, rows) };
}

/**
 * Derive one trip's line from what the store holds, and write it.
 *
 * The second half of the loop, and the half that is a *decision*: importing is
 * the owner handing over their history, and this is them saying that this
 * trip's map may show where they went. It reads the store and hands back
 * counts — never a coordinate.
 *
 * Idempotent, and safe to run again whenever the store gains fixes for those
 * dates. It rewrites one file and touches nothing else.
 */
export function deriveTripTrack(
  username: string,
  trip: { id: string; start: string; end: string },
): { segments: number; points: number; zones: number; written: boolean } {
  const zones = readExcludeZones(username);
  const track = trackForTrip(username, { start: trip.start, end: trip.end, zones });
  const points = trackPointCount(track);
  // Nothing in the store for these dates is not an error — it is a journal
  // that has not imported that fortnight. Writing an empty track would replace
  // a good one with nothing, which is the worse of the two answers.
  if (track.segments.length === 0)
    return { segments: 0, points: 0, zones: zones.length, written: false };
  writeTrack(username, trip.id, track);
  return { segments: track.segments.length, points, zones: zones.length, written: true };
}

/** Whether this trip has a line at all, for a status answer. Says if, never
 * where. */
export function hasTrack(username: string, tripId: string): boolean {
  return readTrack(username, tripId) !== undefined;
}
