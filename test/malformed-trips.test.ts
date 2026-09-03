import { afterEach, describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getMalformedTrips, getTrips } from "@/lib/trips";

/**
 * A `trip.md` the reader cannot parse is dropped from `getTrips`, and until B83
 * the drop was silent: a journal whose only trip was malformed looked empty,
 * and the owner was told there were no trips while the trip sat on disk. These
 * check that the reason survives to a caller (`getMalformedTrips`) and that a
 * broken trip never contaminates the good ones (`getTrips`).
 */

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"u"},"users":{"reserved":[]},"features":{}}';
const USER_CFG =
  '{"title":"F","tagline":"t","owner":{"name":"A B","nickname":"A"},"startLocation":"X","defaultLocale":"en","locales":["en"],"baseCurrency":"CHF","displayCurrencies":["CHF"],"units":"metric","features":{}}';

function journal(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "malformed-trips-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "u"), { recursive: true });
  fs.writeFileSync(path.join(dir, "u", "config.json"), USER_CFG);
  process.env.CONTENT_DIR = dir;
  return dir;
}

function writeTrip(dir: string, folder: string, body: string): void {
  fs.mkdirSync(path.join(dir, "u", "trips", folder), { recursive: true });
  fs.writeFileSync(path.join(dir, "u", "trips", folder, "trip.md"), body);
}

const GOOD = (id: string) =>
  `---\nid: ${id}\ntitle: "A Trip"\nstart: "2024-01-01"\nend: "2024-01-09"\nstatus: past\n---\n\nx\n`;

afterEach(() => {
  delete process.env.CONTENT_DIR;
});

describe("getMalformedTrips", () => {
  test("a folder whose id does not match is reported, not silently dropped", () => {
    const dir = journal();
    writeTrip(dir, "asia-2023", GOOD("not-asia"));
    expect(getTrips("u")).toHaveLength(0);
    const bad = getMalformedTrips("u");
    expect(bad).toHaveLength(1);
    expect(bad[0].folder).toBe("asia-2023");
    expect(bad[0].problem).toContain("folder");
  });

  test("a missing id names the folder to add", () => {
    const dir = journal();
    writeTrip(dir, "asia-2023", `---\ntitle: "x"\nstart: "2024-01-01"\nend: "2024-01-02"\n---\n\nx\n`);
    expect(getMalformedTrips("u")[0].problem).toContain("id: asia-2023");
  });

  test("a start that is not a date is reported", () => {
    const dir = journal();
    writeTrip(dir, "asia-2023", `---\nid: asia-2023\ntitle: "x"\nstart: "soon"\nend: "2024-01-02"\n---\n\nx\n`);
    const bad = getMalformedTrips("u");
    expect(bad).toHaveLength(1);
    expect(bad[0].problem).toContain("date");
  });

  test("unparseable frontmatter is reported rather than thrown", () => {
    const dir = journal();
    writeTrip(dir, "asia-2023", `---\nid: [unterminated\n---\n\nx\n`);
    const bad = getMalformedTrips("u");
    expect(bad).toHaveLength(1);
    expect(bad[0].problem).toContain("parse");
  });

  test("a good trip is unaffected and a folder with no trip.md is not reported", () => {
    const dir = journal();
    writeTrip(dir, "asia-2023", GOOD("asia-2023"));
    writeTrip(dir, "broken-2024", GOOD("wrong-id"));
    fs.mkdirSync(path.join(dir, "u", "trips", "media"), { recursive: true }); // no trip.md

    expect(getTrips("u").map((t) => t.id)).toEqual(["asia-2023"]);
    const bad = getMalformedTrips("u");
    expect(bad.map((b) => b.folder)).toEqual(["broken-2024"]);
  });
});
