import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import fixesImporter from "@/importers/gps/fixes";
import { checkGpsImporter } from "@/importers/gps/schema";
import { LOCATION_EXAMPLE_HREF, LOCATION_EXAMPLE_ROWS } from "@/components/studio/location/LocationSample";

/**
 * B2240 — the location page's "What the file looks like" panel and the
 * example JSON it links to. The file is the table's seven rows, and it
 * reads cleanly through the real `fixes` importer.
 */

const file = path.join(process.cwd(), "public", LOCATION_EXAMPLE_HREF);
const text = fs.readFileSync(file, "utf8");

describe("the example location file", () => {
  test("is served from public/ and holds exactly the sample rows", () => {
    const parsed = JSON.parse(text) as { t: string; lat: number; lon: number }[];
    expect(parsed).toEqual(LOCATION_EXAMPLE_ROWS.map((r) => ({ ...r })));
  });

  test("the fixes importer detects and reads it, and checkGpsImporter finds no problems", () => {
    expect(fixesImporter.detect(text, "location-example.json")).toBe(true);
    const fixes = fixesImporter.parse(text);
    expect(fixes).toHaveLength(LOCATION_EXAMPLE_ROWS.length);
    expect(checkGpsImporter(fixesImporter, fixes)).toEqual([]);
  });
});
