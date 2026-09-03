import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

/** Silences the `[trips]` warnings these fixtures deliberately provoke. */
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  warn.mockRestore();
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

  test("a good trip is unaffected by a broken one beside it", () => {
    const dir = journal();
    writeTrip(dir, "asia-2023", GOOD("asia-2023"));
    writeTrip(dir, "broken-2024", GOOD("wrong-id"));

    expect(getTrips("u").map((t) => t.id)).toEqual(["asia-2023"]);
    expect(getMalformedTrips("u").map((b) => b.folder)).toEqual(["broken-2024"]);
  });

  /**
   * This asserted the opposite when B83 first landed — a folder with no
   * `trip.md` was read as "never claimed to be a trip, so nothing to report".
   * Reversed deliberately.
   *
   * Nothing else lives directly under `trips/`: a trip's own media sit at
   * `trips/<trip-id>/media/`, one level further down, and no code path in the
   * project writes a bare directory there. So the only way to make one is to
   * be halfway through creating a trip — which is precisely the agent this
   * task exists for, the one whose `mkdir` succeeded and whose write of the
   * file did not. Staying quiet about that is the original bug wearing a
   * different hat.
   *
   * The cost of being wrong is small and self-clearing: a stray folder earns
   * one owner-only line that goes away when the folder is finished or removed.
   * The cost of the silence is an agent that cannot tell its work from thin
   * air.
   */
  test("a folder with no trip.md at all is reported too", () => {
    const dir = journal();
    fs.mkdirSync(path.join(dir, "u", "trips", "half-made"), { recursive: true });

    const bad = getMalformedTrips("u");
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ folder: "half-made", reason: "no-file" });
  });
});

/**
 * The reason travels as a code so the owner can be told in their journal's
 * language, while the log and the API keep the English sentence. If the two
 * ever drift apart, the panel starts rendering a raw key.
 */
describe("every refusal names which one it is", () => {
  const cases: [string, string, string][] = [
    ["no-file", "half-made", ""],
    ["unparseable", "asia-2023", `---\nid: [unterminated\n---\n`],
    ["missing-id", "asia-2023", `---\ntitle: "x"\nstart: "2024-01-01"\nend: "2024-01-02"\n---\n`],
    ["id-mismatch", "asia-2023", GOOD("not-asia")],
    [
      "missing-fields",
      "asia-2023",
      `---\nid: asia-2023\ntitle: "x"\nstart: "soon"\nend: "2024-01-02"\n---\n`,
    ],
  ];

  for (const [reason, folder, body] of cases) {
    test(reason, () => {
      const dir = journal();
      if (body) writeTrip(dir, folder, body);
      else fs.mkdirSync(path.join(dir, "u", "trips", folder), { recursive: true });
      expect(getMalformedTrips("u")[0].reason).toBe(reason);
    });
  }

  /**
   * `invalid-id` needs a folder name that is not a legal id, since the folder
   * *is* the id by the time this check runs.
   */
  test("invalid-id", () => {
    const dir = journal();
    writeTrip(dir, "Asia 2023", GOOD("Asia 2023"));
    expect(getMalformedTrips("u")[0].reason).toBe("invalid-id");
  });

  /** All three at once, not just the first: an agent fixing its own file
   * should not have to resubmit to discover the next fault. */
  test("a missing title and both dates are named together", () => {
    const dir = journal();
    writeTrip(dir, "asia-2023", `---\nid: asia-2023\n---\n\nx\n`);
    const [bad] = getMalformedTrips("u");
    expect(bad.problem).toContain("title, start, end");
  });

  test("the server log still gets the English sentence it always got", () => {
    const dir = journal();
    writeTrip(dir, "asia-2023", GOOD("not-asia"));
    getMalformedTrips("u");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[trips] asia-2023/"));
  });
});

describe("the list a caller gets back", () => {
  test("is ordered by folder, so the owner's notice does not reshuffle", () => {
    const dir = journal();
    writeTrip(dir, "zulu", GOOD("wrong"));
    writeTrip(dir, "alpha", GOOD("wrong"));
    expect(getMalformedTrips("u").map((b) => b.folder)).toEqual(["alpha", "zulu"]);
  });

  /**
   * The trips are cached — one `stat` per trip against re-parsing every file
   * on every call — and the refusals turn over with them. A fix that needed a
   * restart to be believed would leave the owner reading a warning about a
   * file they have already corrected, which is its own version of this bug.
   */
  test("clears when the file is fixed, without a restart", () => {
    const dir = journal();
    writeTrip(dir, "asia-2023", GOOD("not-asia"));
    expect(getMalformedTrips("u")).toHaveLength(1);

    writeTrip(dir, "asia-2023", GOOD("asia-2023"));
    expect(getMalformedTrips("u")).toEqual([]);
    expect(getTrips("u").map((t) => t.id)).toEqual(["asia-2023"]);
  });
});
