// B1596 — the v2 route plumbing's own self-check: turning a ZodError into
// the two refusal bodies, the ETag/If-Match pair (V11), dryRun (T1), and the
// one error envelope every v2 route answers with.
import type { ZodType } from "zod";
import { describe, expect, it } from "vitest";
import { dayDoc, dayWrite } from "../lib/api/v2/schemas";
import { incompleteFrom, problemsFrom, splitIssues } from "../lib/api/v2/incomplete";
import { etagFor, fail, ifMatchStale, logV2Request, ok, readDryRun, readJson, V2_ONLY_CODES, V2_STATUS } from "../lib/api/v2/route";
import { ERROR_CODES } from "../lib/api/errorCodes";

const people = [{ name: "Example Owner", email: "owner@example.com" }];

/** A day with every declinable section silently omitted — nothing brought,
 * nothing declined — so every one of DAY_DECLINABLES fires as `missing`. */
const bareDay = {
  slug: "2026-09-20-arrival",
  title: "Arrival",
  date: "2026-09-20",
  content: "We landed.",
};

describe("incompleteFrom", () => {
  const result = dayWrite.safeParse(bareDay);
  if (result.success) throw new Error("expected the bare day to fail — nothing was declined");
  const { missing } = incompleteFrom(result.error, dayDoc.shape as unknown as Record<string, ZodType>);

  it("names every silently-omitted section, not just the first", () => {
    const fields = missing.map((m) => m.field).sort();
    expect(fields).toEqual(
      [
        "coordinates",
        "costs",
        "countryCode",
        "country",
        "location",
        "media",
        "status",
        "tags",
        "time",
        "timezone",
        "transportMode",
        "translations",
        "visibility",
        "weather",
      ].sort(),
    );
  });

  it("why_required is the schema's own sentence, not a second copy", () => {
    const row = missing.find((m) => m.field === "coordinates")!;
    expect(row.why_required).toBe("a day carries where it happened (lat/lng), or says why there is no position");
  });

  it("to_provide is a generated JSON schema, not typed prose", () => {
    const row = missing.find((m) => m.field === "coordinates")!;
    const schema = row.to_provide as { properties?: { lat?: unknown; lng?: unknown } };
    expect(schema.properties).toHaveProperty("lat");
    expect(schema.properties).toHaveProperty("lng");
  });

  it("to_decline reads declined.<field>: <reason>", () => {
    const row = missing.find((m) => m.field === "costs")!;
    expect(row.to_decline).toBe("declined.costs: <reason>");
  });

  it("dedupes by field, keeping the first occurrence", () => {
    const fields = missing.map((m) => m.field);
    expect(new Set(fields).size).toBe(fields.length);
  });
});

describe("splitIssues", () => {
  it("reports both halves when a body is incomplete AND wrong", () => {
    const bad = { ...bareDay, title: "" };
    const result = dayWrite.safeParse(bad);
    if (result.success) throw new Error("expected an empty title to fail");
    const { incomplete, problems } = splitIssues(result.error, dayDoc.shape as unknown as Record<string, ZodType>);
    expect(incomplete).not.toBeNull();
    expect(incomplete!.missing.length).toBeGreaterThan(0);
    expect(incomplete!.problems).toBeDefined();
    expect(incomplete!.problems!.some((p) => p.field === "title")).toBe(true);
    expect(problems.some((p) => p.field === "title")).toBe(true);
  });

  it("is the ordinary refusal (no incomplete body) when nothing is missing", () => {
    const bad = { ...bareDay, title: "", declined: {} };
    // still incomplete because declined is empty — build a fully-declined-but-invalid doc instead
    const declined = {
      media: "no photographs",
      costs: "nothing spent",
      coordinates: "not recorded",
      weather: "declined",
      time: "not known",
      timezone: "not known",
      location: "not known",
      country: "not known",
      countryCode: "not known",
      transportMode: "rest day",
      tags: "none",
      translations: "single language",
      visibility: "default",
      status: "n/a here",
    };
    const result = dayWrite.safeParse({ ...bareDay, title: "", declined });
    if (result.success) throw new Error("expected an empty title to fail");
    const { incomplete, problems } = splitIssues(result.error, dayDoc.shape as unknown as Record<string, ZodType>);
    expect(incomplete).toBeNull();
    expect(problems.some((p) => p.field === "title")).toBe(true);
  });
});

describe("problemsFrom", () => {
  it("lists every problem, never just the first", () => {
    const bad = { ...bareDay, title: "", countryCode: "too-long" };
    const result = dayWrite.safeParse(bad);
    if (result.success) throw new Error("expected this body to fail");
    const problems = problemsFrom(result.error);
    expect(problems.some((p) => p.field === "title")).toBe(true);
    expect(problems.some((p) => p.field === "countryCode")).toBe(true);
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });
});

describe("etagFor", () => {
  it("is stable across key reordering", () => {
    const a = etagFor({ title: "Alps", people });
    const b = etagFor({ people, title: "Alps" });
    expect(a).toBe(b);
  });

  it("differs when a value changes", () => {
    const a = etagFor({ title: "Alps" });
    const b = etagFor({ title: "Dolomites" });
    expect(a).not.toBe(b);
  });

  it("is a quoted strong tag", () => {
    expect(etagFor({ x: 1 })).toMatch(/^"[0-9a-f]{32}"$/);
  });

  it("gives two documents differing only in a Date different tags (B1601 — Object.keys(Date) is [])", () => {
    const a = etagFor({ date: new Date("2026-09-12T00:00:00Z") });
    const b = etagFor({ date: new Date("2026-09-13T00:00:00Z") });
    expect(a).not.toBe(b);
  });
});

function reqWithIfMatch(value: string | null): Request {
  const headers = new Headers();
  if (value !== null) headers.set("If-Match", value);
  return new Request("https://example.com/v2/x", { headers });
}

describe("ifMatchStale", () => {
  const current = etagFor({ x: 1 });

  it("no header at all is never stale", () => {
    expect(ifMatchStale(reqWithIfMatch(null), current)).toBe(false);
  });

  it("a matching tag is not stale", () => {
    expect(ifMatchStale(reqWithIfMatch(current), current)).toBe(false);
  });

  it("* always matches", () => {
    expect(ifMatchStale(reqWithIfMatch("*"), current)).toBe(false);
  });

  it("a mismatched tag is stale", () => {
    expect(ifMatchStale(reqWithIfMatch('"deadbeef"'), current)).toBe(true);
  });

  it("a comma list containing a match is not stale", () => {
    expect(ifMatchStale(reqWithIfMatch(`"deadbeef", ${current}`), current)).toBe(false);
  });
});

function reqWithQuery(query: string): Request {
  return new Request(`https://example.com/v2/x${query}`);
}

describe("readDryRun", () => {
  it.each([
    ["?dryRun", true],
    ["?dryRun=", true],
    ["?dryRun=1", true],
    ["?dryRun=true", true],
    ["?dryRun=TRUE", true],
    ["?dryRun=yes", true],
    ["?dryRun=YES", true],
    ["?dryRun=on", true],
    ["?dryRun=0", false],
    ["?dryRun=false", false],
    ["?dryRun=no", false],
    ["?dryRun=off", false],
    ["", false],
    // case-insensitive on the *parameter name* too — ?dryrun=1 must not
    // silently read as "not a dry run" and perform a real write (B1601).
    ["?dryrun=1", true],
    ["?DRYRUN=true", true],
    ["?DryRun=0", false],
    // an unrecognised value is a refusal, never a guess in either direction.
    ["?dryRun=maybe", null],
    ["?dryRun=2", null],
    // given twice with disagreeing values: also a refusal, not "last wins".
    ["?dryRun=true&dryRun=false", null],
  ] as const)("%s -> %s", (query, expected) => {
    expect(readDryRun(reqWithQuery(query))).toBe(expected);
  });

  it("given twice with the same value agrees with itself", () => {
    expect(readDryRun(reqWithQuery("?dryRun=true&dryRun=TRUE"))).toBe(true);
  });
});

describe("readJson", () => {
  it("malformed JSON answers the invalid_json envelope at 400", async () => {
    const request = new Request("https://example.com/v2/x", {
      method: "POST",
      body: "{not json",
      headers: { "content-type": "application/json" },
    });
    const result = await readJson(request);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(400);
    const body = await result.response.json();
    expect(body.error).toBe("invalid_json");
  });

  it("valid JSON parses", async () => {
    const request = new Request("https://example.com/v2/x", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
    });
    const result = await readJson(request);
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });
});

describe("fail", () => {
  it("produces the envelope shape and the status from the map", () => {
    const response = fail("missing_token", "no bearer header");
    expect(response.status).toBe(V2_STATUS.missing_token);
  });

  it("an explicit status overrides the map", () => {
    const response = fail("not_found", "no such trip", undefined, 404);
    expect(response.status).toBe(404);
  });

  it("carries details when given", async () => {
    const response = fail("invalid_request", "bad body", { problems: [{ field: "title", problem: "required" }] });
    const body = await response.json();
    expect(body).toEqual({
      error: "invalid_request",
      message: "bad body",
      details: { problems: [{ field: "title", problem: "required" }] },
    });
  });
});

describe("ok", () => {
  it("sets the ETag header when one is given, and none when it is not", async () => {
    const etag = etagFor({ id: "alps-2026" });
    const tagged = ok({ id: "alps-2026" }, { etag });
    expect(tagged.headers.get("ETag")).toBe(etag);
    expect(ok({ id: "alps-2026" }).headers.get("ETag")).toBeNull();
  });

  it("defaults to 200 and honours an explicit status", async () => {
    expect(ok({}).status).toBe(200);
    expect(ok({}, { status: 201 }).status).toBe(201);
    expect(await ok({ a: 1 }).json()).toEqual({ a: 1 });
  });
});

describe("logV2Request", () => {
  const fields = {
    method: "POST",
    path: "/api/v2/example/trips/alps-2026/days/2026-01-01-first",
    status: 201,
    ms: 42,
    token: "sess_abc",
    journal: "example",
  };

  it("says nothing at all when the logging feature is off", () => {
    const lines: unknown[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => lines.push(args);
    try {
      logV2Request({ ...fields, enabled: false });
    } finally {
      console.log = original;
    }
    expect(lines).toEqual([]);
  });

  it("logs one metadata line when it is on, and never a body or a query string", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => lines.push(String(args[0]));
    try {
      logV2Request({ ...fields, enabled: true });
    } finally {
      console.log = original;
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("POST");
    expect(lines[0]).toContain(fields.path);
    expect(lines[0]).toContain("example");
    expect(lines[0]).not.toContain("?");
  });

  it("never throws — a lost log line is not worth a lost response", () => {
    const original = console.log;
    console.log = () => {
      throw new Error("stdout is gone");
    };
    try {
      expect(() => logV2Request({ ...fields, enabled: true })).not.toThrow();
    } finally {
      console.log = original;
    }
  });
});

describe("V2_ONLY_CODES", () => {
  /**
   * The contract's IOU, asserted rather than only commented. These two codes
   * are what v2's plumbing answers with and the published vocabulary does not
   * yet carry, because `test/openapi-contract.test.ts` fails on a code no
   * route answers and no v2 route exists yet. When the first route answering
   * them ships (phase 2 step 3), they move into `ERROR_CODES` and this list
   * empties — at which point this test is what says so out loud.
   */
  it("names codes that are deliberately not in ERROR_CODES yet", () => {
    expect(V2_ONLY_CODES.length).toBeGreaterThan(0);
    for (const code of V2_ONLY_CODES) {
      expect(code in ERROR_CODES).toBe(false);
    }
  });

  it("every code the status map knows is either published or on the IOU", () => {
    for (const code of Object.keys(V2_STATUS)) {
      const known = code in ERROR_CODES || (V2_ONLY_CODES as readonly string[]).includes(code);
      expect(known, `${code} is in V2_STATUS but in no vocabulary`).toBe(true);
    }
  });
});
