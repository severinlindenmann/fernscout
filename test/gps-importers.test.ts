import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { checkGpsImporter, type GpsImporter } from "@/importers/gps/schema";
import timeline from "@/importers/gps/google-timeline";
import records from "@/importers/gps/google-records";
import gpx from "@/importers/gps/gpx";
import fixes from "@/importers/gps/fixes";

/**
 * B665 — the MIT folder.
 *
 * Every coordinate in here is invented. The formats were written against a
 * real ten-month Google export, and the export itself is nobody's business but
 * its owner's — which is the same reason `test/depersonalised.test.ts` exists.
 *
 * The last test is the one that matters most to somebody adding their own
 * importer: the folder is the registry, so anything dropped in it has to hold
 * up the contract without being named anywhere.
 */

const HOME = "geo:47.10000,8.10000";

describe("google-timeline", () => {
  const file = JSON.stringify([
    {
      startTime: "2026-06-22T06:00:00.000Z",
      endTime: "2026-06-22T07:00:00.000Z",
      timelinePath: [
        { point: HOME, durationMinutesOffsetFromStartTime: "0" },
        { point: "geo:47.20000,8.20000", durationMinutesOffsetFromStartTime: "30" },
      ],
    },
    {
      startTime: "2026-06-22T08:00:00.000+02:00",
      endTime: "2026-06-22T09:00:00.000+02:00",
      activity: {
        start: "geo:47.30000,8.30000",
        end: "geo:47.40000,8.40000",
        topCandidate: { type: "in train" },
      },
    },
    {
      startTime: "2026-06-22T12:00:00.000Z",
      endTime: "2026-06-22T14:00:00.000Z",
      visit: { topCandidate: { placeLocation: "geo:47.50000,8.50000", semanticType: "Unknown" } },
    },
  ]);

  test("reads paths, activities and visits", () => {
    const out = timeline.parse(file);
    expect(out.map((f) => f.lat)).toEqual([47.1, 47.2, 47.3, 47.4, 47.5]);
  });

  test("puts a path point at its offset from the segment's start", () => {
    expect(timeline.parse(file)[1].t).toBe(Date.parse("2026-06-22T06:30:00Z"));
  });

  test("reads a local offset as the instant it is", () => {
    expect(timeline.parse(file)[2].t).toBe(Date.parse("2026-06-22T06:00:00Z"));
  });

  test("keeps no guess about how somebody travelled", () => {
    // Google says "in train" with a probability. That is a guess about what
    // happened, and what happened is the one thing this software never
    // invents — see AGENTS.md.
    expect(JSON.stringify(timeline.parse(file))).not.toContain("train");
  });

  test("skips a segment it cannot read rather than losing the file", () => {
    const broken = JSON.stringify([
      { startTime: "nonsense", timelinePath: [{ point: HOME }] },
      { startTime: "2026-06-22T06:00:00Z", timelinePath: [{ point: "not-a-geo-uri" }] },
      { startTime: "2026-06-22T07:00:00Z", timelinePath: [{ point: HOME }] },
    ]);
    expect(timeline.parse(broken)).toHaveLength(1);
  });

  test("recognises itself and not a GPX", () => {
    expect(timeline.detect(file, "Timeline.json")).toBe(true);
    expect(timeline.detect("<gpx><trkpt/></gpx>", "track.gpx")).toBe(false);
  });
});

describe("google-records", () => {
  const file = JSON.stringify({
    locations: [
      { timestamp: "2026-06-22T06:00:00Z", latitudeE7: 471000000, longitudeE7: 81000000, accuracy: 12 },
      // A cell-tower fix claiming five kilometres of accuracy: not a place
      // anybody was, and drawn as a line it invents a detour.
      { timestamp: "2026-06-22T06:05:00Z", latitudeE7: 471000000, longitudeE7: 81000000, accuracy: 5000 },
      { timestampMs: "1782108000000", latitudeE7: 472000000, longitudeE7: 82000000 },
    ],
  });

  test("scales E7 coordinates and drops the inaccurate fix", () => {
    const out = records.parse(file);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ lat: 47.1, lon: 8.1 });
  });

  test("reads both the ISO and the millisecond timestamp", () => {
    const out = records.parse(file);
    expect(out[0].t).toBe(Date.parse("2026-06-22T06:00:00Z"));
    expect(out[1].t).toBe(1782108000000);
  });
});

const GPX_FILE = `<?xml version="1.0"?>
<gpx version="1.1"><trk><trkseg>
  <trkpt lat="47.1" lon="8.1"><ele>410</ele><time>2026-06-22T06:00:00Z</time></trkpt>
  <trkpt lat="47.2" lon="8.2"><time>2026-06-22T06:05:00Z</time></trkpt>
  <trkpt lat="47.3" lon="8.3"></trkpt>
</trkseg></trk></gpx>`;

describe("gpx", () => {
  const file = GPX_FILE;

  test("reads points with a time and skips one without", () => {
    // A fix that does not know when it happened has nowhere to go: the store
    // is ordered by time and a trip is clipped by it.
    const out = gpx.parse(file);
    expect(out.map((f) => f.lat)).toEqual([47.1, 47.2]);
  });

  test("recognises a .gpx by name or by root element", () => {
    expect(gpx.detect("", "walk.gpx")).toBe(true);
    expect(gpx.detect(file, "export.xml")).toBe(true);
  });
});

describe("fixes — the format for a tool that is not TypeScript", () => {
  test("reads both line shapes, and seconds or an instant", () => {
    const out = fixes.parse(
      ['[1782108000, 47.1, 8.1]', '{"t": "2026-06-22T06:00:00Z", "lat": 47.2, "lon": 8.2}'].join(
        "\n",
      ),
    );
    expect(out[0]).toEqual({ t: 1782108000000, lat: 47.1, lon: 8.1 });
    expect(out[1]).toEqual({ t: Date.parse("2026-06-22T06:00:00Z"), lat: 47.2, lon: 8.2 });
  });

  test("skips a line it cannot read", () => {
    expect(fixes.parse("[1782108000, 47.1, 8.1]\nnot json\n# a comment")).toHaveLength(1);
  });

  test("reads a whole JSON array too, because that is what a first attempt writes", () => {
    expect(fixes.parse('[[1782108000, 47.1, 8.1], [1782108300, 47.2, 8.2]]')).toHaveLength(2);
  });
});

describe("the folder is the registry", () => {
  test("every importer in it holds up the contract, without being named here", async () => {
    // `importers/gps/`, not `importers/` — the kind of data is the folder, so
    // a costs importer arriving later is a sibling directory rather than a
    // file this walk has to learn to skip.
    const root = path.join(process.cwd(), "importers", "gps");
    const files = fs.readdirSync(root).filter((n) => n.endsWith(".ts") && n !== "schema.ts");
    expect(files.length).toBeGreaterThan(0);

    const ids = new Set<string>();
    for (const name of files) {
      const loaded = (await import(path.join(root, name))) as { default?: GpsImporter };
      const importer = loaded.default;
      expect(importer, `${name} exports no importer`).toBeDefined();
      expect(importer!.id).toMatch(/^[a-z0-9-]+$/);
      expect(importer!.label.length).toBeGreaterThan(0);
      expect(typeof importer!.detect).toBe("function");
      expect(typeof importer!.parse).toBe("function");
      expect(ids.has(importer!.id), `two importers called ${importer!.id}`).toBe(false);
      ids.add(importer!.id);
    }
  });

  test("checkGpsImporter names what is wrong, which is how somebody writes one", () => {
    // The function `importers/README.md` tells a contributor to run. Each of
    // these is a mistake somebody actually makes on a first attempt.
    const ok = { id: "mine", label: "Mine" } as GpsImporter;
    expect(checkGpsImporter(ok, [{ t: 1782108000000, lat: 47.1, lon: 8.1 }])).toEqual([]);

    // Seconds where milliseconds were asked for: a 2026 trip lands in 1970.
    expect(checkGpsImporter(ok, [{ t: 1782108000, lat: 47.1, lon: 8.1 }]).join(" ")).toMatch(
      /milliseconds/,
    );
    // The pair the wrong way round — Zurich in the Gulf of Guinea.
    expect(checkGpsImporter(ok, [{ t: 1782108000000, lat: 8.1, lon: 471 }]).join(" ")).toMatch(
      /not on Earth/,
    );
    expect(checkGpsImporter(ok, []).join(" ")).toMatch(/returned nothing/);
    expect(
      checkGpsImporter({ ...ok, id: "My Tracker" }, [
        { t: 1782108000000, lat: 47.1, lon: 8.1 },
      ]).join(" "),
    ).toMatch(/lowercase/);
  });

  test("every importer here passes its own check on its own fixture", () => {
    expect(checkGpsImporter(gpx, gpx.parse(GPX_FILE))).toEqual([]);
  });

  test("no importer claims a file that is plainly somebody else's", () => {
    // A loose `detect` is worse than a strict one: `--format <id>` always
    // overrides, and a wrong parse is silent.
    for (const importer of [timeline, records, gpx]) {
      expect(importer.detect("id,name\n1,a\n", "budget.csv"), importer.id).toBe(false);
    }
  });
});
