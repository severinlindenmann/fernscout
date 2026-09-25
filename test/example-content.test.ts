/**
 * `content/example` is the acceptance fixture — B1643, M3.
 *
 * Two properties, and the second is the one that keeps the first honest:
 *
 * 1. **It is valid.** Every file parses with the real serializers and
 *    validates against the real schemas, through `buildTripDoc` — the same
 *    function every GET/PUT echo of a trip goes through. Not a second
 *    implementation of the format: if this passes, the routes can serve it.
 *
 * 2. **It is complete.** Every field the contract defines, and every value of
 *    every enum, is demonstrated somewhere in the journal. The expectation is
 *    derived from the schemas themselves at run time, so a field added to the
 *    contract tomorrow fails HERE until the example shows it. That is what
 *    makes the demo a fixture rather than a snapshot: "the example shows
 *    everything" stops being a claim somebody has to remember and becomes a
 *    test somebody has to satisfy.
 *
 * A failure here is never "relax the test": it is either a field the example
 * owes a demonstration of, or a field the contract should not have.
 */
import path from "node:path";
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DAY_DECLINABLE_KEYS,
  TRIP_DECLINABLE_KEYS,
  dayWrite,
  figureDoc,
  journalWrite,
  tripCreate,
} from "@/lib/api/v2/schemas";
import { dayFromJson, dayToJson, tripFromJson, tripToJson } from "@/lib/api/v2/documents";
import { buildTripDoc } from "@/lib/api/v2/trips";
import { readTripFile } from "@/lib/api/v2/store";

const REPO_CONTENT = path.join(process.cwd(), "content");
const USER = "example";
const EXAMPLE = path.join(REPO_CONTENT, USER);

let previousContentDir: string | undefined;
beforeAll(() => {
  // Point the store at the repository's own content, not at whatever fixture
  // directory another test left behind.
  previousContentDir = process.env.CONTENT_DIR;
  process.env.CONTENT_DIR = REPO_CONTENT;
});
afterAll(() => {
  if (previousContentDir === undefined) delete process.env.CONTENT_DIR;
  else process.env.CONTENT_DIR = previousContentDir;
});

/** ── what the contract defines ────────────────────────────────────────── */

type Expectation = { paths: Set<string>; enums: Map<string, string[]> };

/**
 * Walk a schema's JSON-Schema projection and collect every leaf path a
 * document could carry, plus every enum and its values. Unions contribute
 * all of their branches: `weather` is `true | reading`, and the example owes
 * a demonstration of both.
 */
function expectationsOf(schema: z.ZodType, skip: readonly string[] = []): Expectation {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  const paths = new Set<string>();
  const enums = new Map<string, string[]>();

  const walk = (node: unknown, prefix: string, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 5) return;
    const n = node as Record<string, unknown>;
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      const branches = n[key];
      if (Array.isArray(branches)) {
        for (const b of branches) walk(b, prefix, depth);
      }
    }
    const props = n.properties as Record<string, Record<string, unknown>> | undefined;
    if (!props) return;
    for (const [key, value] of Object.entries(props)) {
      const p = prefix ? `${prefix}.${key}` : key;
      if (skip.includes(p)) continue;
      paths.add(p);
      if (Array.isArray(value.enum)) enums.set(p, value.enum.map(String));
      if (value.type === "object" || value.properties) walk(value, p, depth + 1);
      if (value.type === "array" && value.items) walk(value.items, `${p}[]`, depth + 1);
      for (const key2 of ["anyOf", "oneOf"]) {
        const branches = value[key2];
        if (Array.isArray(branches)) for (const b of branches) walk(b, p, depth + 1);
      }
    }
  };
  walk(json, "", 0);
  return { paths, enums };
}

/** ── what the content demonstrates ───────────────────────────────────── */

function demonstrate(doc: unknown, prefix: string, paths: Set<string>, values: Set<string>): void {
  if (doc === undefined || doc === null) return;
  if (Array.isArray(doc)) {
    for (const item of doc) demonstrate(item, `${prefix}[]`, paths, values);
    return;
  }
  if (typeof doc === "object") {
    for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
      const p = prefix ? `${prefix}.${key}` : key;
      if (value === undefined) continue;
      paths.add(p);
      demonstrate(value, p, paths, values);
    }
    return;
  }
  // A leaf: record it as a value seen at this path, for the enum check.
  values.add(`${prefix}=${String(doc)}`);
}

/** ── the journal, read from disk ─────────────────────────────────────── */

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

const tripIds = fs
  .readdirSync(path.join(EXAMPLE, "trips"))
  .filter((d) => fs.statSync(path.join(EXAMPLE, "trips", d)).isDirectory())
  .sort();

const daySlugsOf = (tripId: string): string[] => {
  const dir = path.join(EXAMPLE, "trips", tripId, "entries");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
};

describe("content/example is v2-canonical", () => {
  it("carries no v1 markdown at all", () => {
    const stray: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".md")) stray.push(path.relative(EXAMPLE, full));
      }
    };
    walk(path.join(EXAMPLE, "trips"));
    expect(stray).toEqual([]);
  });

  /**
   * B1684 — every `src` a day names points at bytes that are actually there.
   *
   * The Lisbon trip named four photographs and shipped none, so the demo had
   * days claiming pictures nobody could load, and nothing anywhere said so.
   * A dangling `src` is invisible to the schema (it is a well-formed string)
   * and invisible to the round-trip check (it serialises perfectly). Only
   * looking at the disk finds it.
   *
   * The narrow attach doors already resolve a `src` against stored bytes
   * (`attachDayMedia`/`srcStoredInTrip`), but a whole-day PUT or PATCH does
   * not — so content written that way, which is how the demo is written, has
   * no such check. This is that check, for the one journal that ships in the
   * repository.
   */
  it("every photograph a day names is actually on disk", () => {
    const dangling: string[] = [];
    for (const trip of fs.readdirSync(path.join(EXAMPLE, "trips"))) {
      const entries = path.join(EXAMPLE, "trips", trip, "entries");
      if (!fs.existsSync(entries)) continue;
      for (const file of fs.readdirSync(entries)) {
        const day = readJson(path.join(entries, file)) as {
          media?: { src?: string }[];
        };
        for (const item of day.media ?? []) {
          if (!item.src) continue;
          // `/media/<trip>/…` is trip-relative; the username is added at read
          // time (`mediaWithOwner`), so the file sits under the trip itself.
          const rel = item.src.replace(/^\/media\/[^/]+\//, "");
          if (!fs.existsSync(path.join(EXAMPLE, "trips", trip, "media", rel))) {
            dangling.push(`${trip}/${file}: ${item.src}`);
          }
        }
      }
    }
    expect(dangling).toEqual([]);
  });

  it("the journal document validates", () => {
    // Decision 5 landed (B1666): `features` is instance-only now, and
    // `content/example/config.json` no longer carries the legacy key this
    // test used to strip before validating — the file is a plain v2 journal
    // document, whole.
    const config = readJson(path.join(EXAMPLE, "config.json"));
    expect(config).not.toHaveProperty("features");
    expect(journalWrite.safeParse(config)).toMatchObject({ success: true });
  });

  it("every figure in the library validates", () => {
    const dir = path.join(EXAMPLE, "figures");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const result = figureDoc.safeParse(readJson(path.join(dir, file)));
      expect(result.success, `${file}: ${result.success ? "" : JSON.stringify(result.error.issues)}`).toBe(true);
    }
  });

  it.each(tripIds)("%s validates as a whole document, days included", (tripId) => {
    const trip = readTripFile(USER, tripId);
    expect(trip, `${tripId}/trip.json does not read`).not.toBeNull();

    // `buildTripDoc(..., "full")` ends in `tripDoc.parse` — the same call
    // every GET and every write echo of a trip goes through, days included
    // (each one through `dayEchoInput`). If this returns, the routes can
    // serve this trip; if it throws, they cannot. No second implementation
    // of the format lives in this test.
    expect(() => buildTripDoc(USER, tripId, trip!, "full")).not.toThrow();
  });

  it.each(tripIds)("%s: every day file reads and carries a real status", (tripId) => {
    for (const slug of daySlugsOf(tripId)) {
      const day = readJson(path.join(EXAMPLE, "trips", tripId, "entries", `${slug}.json`));
      expect(["draft", "published"], `${tripId}/${slug} status`).toContain(day.status);
    }
  });
});

/** ── completeness ─────────────────────────────────────────────────────── */

/**
 * Every field and every enum value the contract defines, demonstrated
 * somewhere in the journal. The expectation is read from the schemas at run
 * time, so this cannot go stale: add a field to `dayWrite` tomorrow and this
 * fails until `content/example` shows what it looks like in use.
 *
 * The point is not tidiness. The example is what an agent copies and what a
 * feature is proven against — a field nothing demonstrates is a field whose
 * first real use is somebody's actual journal.
 */
describe("content/example demonstrates the whole contract", () => {
  const days = tripIds.flatMap((t) =>
    daySlugsOf(t).map((slug) => readJson(path.join(EXAMPLE, "trips", t, "entries", `${slug}.json`))),
  );
  const trips = tripIds.map((t) => readJson(path.join(EXAMPLE, "trips", t, "trip.json")));
  const figures = fs
    .readdirSync(path.join(EXAMPLE, "figures"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson(path.join(EXAMPLE, "figures", f)));
  const journal = readJson(path.join(EXAMPLE, "config.json"));

  const seen = (docs: unknown[]): { paths: Set<string>; values: Set<string> } => {
    const paths = new Set<string>();
    const values = new Set<string>();
    for (const doc of docs) demonstrate(doc, "", paths, values);
    return { paths, values };
  };

  /**
   * `singleton` marks a document a journal has exactly one of. A collection
   * (44 days, 8 trips, a figure library) can be asked to show every value of
   * every enum; one document cannot — a journal is `metric` **or**
   * `imperial`, and no amount of content makes it both. For those, the field
   * is still owed a demonstration; only the exhaustive enum sweep is not.
   */
  type EnumRule = "exhaustive" | "one-of" | "present";

  const cases: [string, z.ZodType, unknown[], readonly string[], EnumRule][] = [
    // `slug` is the filename and never a key inside the document; `days` is
    // the trip's inline projection, which a stored trip file never carries.
    ["day", dayWrite, days, ["slug"], "exhaustive"],
    ["trip", tripCreate, trips, ["days", "id"], "exhaustive"],
    // `declined` is skipped for one reason only: the journal's two declinable
    // sections are `tagline` and `figures`, and the demo wants both. Showing
    // a declined journal section would mean taking one away — the example
    // teaching the mechanism by being a worse example. The mechanism is
    // demonstrated 200-odd times over on days and trips instead.
    ["journal", journalWrite, [journal], ["declined"], "one-of"],
    // `appearance` marks the drawing vocabulary — hairStyle, outfit, build,
    // age. Every FIELD is still owed a demonstration, and every value is
    // still rendered and checked: at /docs/branding/travellers, the bench
    // that draws each axis from the vocabulary constant, which is where a
    // wrong drawing actually shows. Forcing the journal's own cast to wear
    // all eleven hairstyles would make the demo less believable, not more
    // complete — the journal proves that figures are referenced and drawn,
    // the bench proves that each value draws.
    ["figure", figureDoc, figures, ["id"], "present"],
  ];

  it.each(cases)("every %s field is demonstrated", (_name, schema, docs, skip) => {
    const want = expectationsOf(schema, skip);
    const have = seen(docs);
    const missing = [...want.paths].filter((p) => !have.paths.has(p) && !skip.includes(p)).sort();
    expect(missing, `never demonstrated in content/example: ${missing.join(", ")}`).toEqual([]);
  });

  it.each(cases.filter(([, , , , rule]) => rule === "exhaustive"))(
    "every %s enum value is demonstrated",
    (_name, schema, docs, skip) => {
      const want = expectationsOf(schema, skip);
      const have = seen(docs);
      const missing: string[] = [];
      for (const [p, allowed] of want.enums) {
        for (const value of allowed) {
          if (!have.values.has(`${p}=${value}`)) missing.push(`${p}=${value}`);
        }
      }
      expect(missing.sort(), `enum values never demonstrated: ${missing.join(", ")}`).toEqual([]);
    },
  );

  it.each(cases.filter(([, , , , rule]) => rule !== "exhaustive"))(
    "%s: every enum field carries at least one value the contract allows",
    (_name, schema, docs, skip) => {
      const want = expectationsOf(schema, skip);
      const have = seen(docs);
      for (const [p, allowed] of want.enums) {
        const used = allowed.filter((v) => have.values.has(`${p}=${v}`));
        expect(used.length, `${p} carries no value the contract allows`).toBeGreaterThan(0);
      }
    },
  );

  it("every declinable section is declined somewhere, with a real reason", () => {
    const declines = [...days, ...trips].flatMap((d) =>
      Object.entries((d.declined ?? {}) as Record<string, string>),
    );
    for (const [key, reason] of declines) {
      expect(reason.length, `declined.${key} carries a reason too short to act on`).toBeGreaterThanOrEqual(10);
    }
    const keys = new Set(declines.map(([k]) => k));
    // `status` is the one declinable a stored day cannot demonstrate: a file
    // always carries `draft` or `published`, because a day on disk is always
    // one or the other. The decline exists for the WIRE — a create call that
    // does not state it arrives as a draft — and is exercised there, in
    // test/api-v2-schemas.test.ts, not here.
    const owed = [...DAY_DECLINABLE_KEYS, ...TRIP_DECLINABLE_KEYS].filter((k) => k !== "status");
    const missing = owed.filter((k) => !keys.has(k)).sort();
    expect(missing, `declinable sections never demonstrated as declined: ${missing.join(", ")}`).toEqual([]);
  });
  /**
   * B1679. `lib/api/v2/documents.ts` states the invariant the whole format
   * rests on: "Key order is fixed so that serialising the same document twice
   * matches byte-for-byte: a diff in git is then always a change in content,
   * never a change in this function's mood."
   *
   * Nine files in this journal did not hold it — `costs` written last instead
   * of after `media`, `accent`/`cover` after `intro`, and one `31.0` that
   * `JSON.stringify` emits as `31`. No data was lost in any of them, which is
   * exactly why nothing caught it: every other check here parses the file and
   * asks about the object. The cost is the next real edit through the API,
   * which would have produced a whole-file reordering beside the one-line
   * change — the diff the invariant exists to prevent.
   *
   * It walks the whole content root rather than this journal, because the
   * property is about the serializers, not about the demo.
   */
  it("every day and trip file on disk round-trips through the serializers byte for byte", () => {
    const drifted: string[] = [];
    for (const user of fs.readdirSync(REPO_CONTENT)) {
      const trips = path.join(REPO_CONTENT, user, "trips");
      if (!fs.existsSync(trips)) continue;
      for (const trip of fs.readdirSync(trips)) {
        const tripFile = path.join(trips, trip, "trip.json");
        if (fs.existsSync(tripFile)) {
          const raw = fs.readFileSync(tripFile, "utf8");
          if (tripToJson(tripFromJson(raw)) !== raw) drifted.push(path.relative(process.cwd(), tripFile));
        }
        const entries = path.join(trips, trip, "entries");
        if (!fs.existsSync(entries)) continue;
        for (const name of fs.readdirSync(entries)) {
          if (!name.endsWith(".json")) continue;
          const file = path.join(entries, name);
          const raw = fs.readFileSync(file, "utf8");
          const slug = name.replace(/\.json$/, "");
          if (dayToJson(dayFromJson(slug, raw)) !== raw) drifted.push(path.relative(process.cwd(), file));
        }
      }
    }
    expect(drifted, `files whose bytes differ from what the serializer would write: ${drifted.join(", ")}`).toEqual([]);
  });
});
