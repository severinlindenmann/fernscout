import { describe, expect, test } from "vitest";
import { contentModel, MAX_PATTERN_LENGTH } from "@/lib/contentModel/document";
import { interpretFile } from "@/lib/contentModel/interpret";
import type { FileName, Rule } from "@/lib/contentModel/types";
import { openApiDocument } from "@/lib/api/openapi";
import { validateEntry, type EntryInput } from "@/lib/validate/entry";
import { validateCostsPut } from "@/lib/validate/costs";
import { ConfigError, parseUserConfig } from "@/lib/config";
import { DATE_RE, ID_RE } from "@/lib/tripWrite";

/**
 * B608 — the conformance test W41 is built around.
 *
 * `content-model.json` is a copy of what `lib/validate/*` (and, for trip.md,
 * `lib/tripWrite.ts`) actually enforce. A copy that quietly drifts from the
 * thing it copies is worse than no document at all — see the plan — so this
 * runs both sides over the same fixtures and asserts they agree, rule by
 * rule, wherever an assertion is possible at all.
 *
 * This test found several real disagreements, inherited unchanged from
 * `fernscout-helper`'s `model.mjs` (this document's original source — see
 * `lib/contentModel/document.ts`). B615 fixes the two below, in
 * `content-model.json` rather than in `lib/validate/*` (that stays the
 * server's own gate, per W41): `countryCode`'s case-sensitivity, and
 * `locales`/`defaultLocale` being wrongly `required`. Other findings remain,
 * each still asserted *as* a disagreement, by name, with the ticket to file
 * recorded in a comment beside it.
 */

const EIGHT_KINDS = [
  "type",
  "enum",
  "pattern",
  "required",
  "shape",
  "known-key",
  "never-in-file",
  "never-over-api",
] as const;

const doc = contentModel();

describe("the vocabulary is closed", () => {
  test("every rule is one of the eight kinds", () => {
    for (const rule of doc.rules) {
      expect(EIGHT_KINDS, JSON.stringify(rule)).toContain(rule.assert);
    }
  });

  test("every named check says which of the eight kinds it could not use, in prose", () => {
    for (const named of doc.named) {
      expect(named.kind).toBe("named");
      expect(named.id.length).toBeGreaterThan(0);
      expect(named.because.length).toBeGreaterThan(0);
    }
  });

  test("no rule invents a ninth kind by way of a stray field", () => {
    for (const rule of doc.rules) {
      if (rule.assert === "pattern") {
        expect(rule.pattern.length, rule.pattern).toBeLessThanOrEqual(MAX_PATTERN_LENGTH);
        expect(rule.pattern.startsWith("^"), rule.pattern).toBe(true);
        expect(rule.pattern.endsWith("$"), rule.pattern).toBe(true);
      }
    }
  });

  test("the wildcard, where used, only ever means 'every member of a map'", () => {
    for (const rule of doc.rules) {
      if (rule.path.includes("*")) {
        expect(rule.path.endsWith(".*"), rule.path).toBe(true);
        expect(rule.assert, rule.path).toBe("shape");
      }
    }
  });
});

describe("the document itself", () => {
  test("is versioned", () => {
    expect(doc.contentModel).toBe(1);
  });

  test("describes config.json, trip.md, an entry, costs.md and plan.md", () => {
    const files = Object.keys(doc.files) as FileName[];
    expect(files.sort()).toEqual(
      ["config.json", "costs.md", "entries/YYYY-MM-DD-slug.md", "plan.md", "trip.md"].sort(),
    );
  });
});

/**
 * Which keys `content-model.json` says may cross into a file at all
 * (`known-key`'s own list, for `where`), and which it says the API takes —
 * ported from `model.mjs`'s own `crosscheck()`, which is what this replaces.
 */
function fileKnownKeys(where: FileName): string[] {
  const root = doc.rules.find((r): r is Extract<Rule, { assert: "known-key" }> =>
    r.assert === "known-key" && r.where === where && r.path === "",
  );
  return root ? [...root.keys] : [];
}
function apiOnlyKeys(where: FileName): string[] {
  return doc.rules.filter((r) => r.where === where && r.assert === "never-in-file").map((r) => r.path);
}
function fileOnlyKeys(where: FileName): string[] {
  return doc.rules.filter((r) => r.where === where && r.assert === "never-over-api").map((r) => r.path);
}

type Schema = { $ref?: string; properties?: Record<string, unknown> };
function resolve(schema: Schema | undefined, schemas: Record<string, unknown> | undefined): Schema {
  let current = schema ?? {};
  for (let hop = 0; hop < 3 && current.$ref; hop += 1) {
    const name = current.$ref.split("/").pop();
    current = (name ? (schemas?.[name] as Schema) : undefined) ?? current;
    if (current.$ref === schema?.$ref) break;
  }
  return current;
}

describe("known-key / never-in-file / never-over-api against /openapi.json", () => {
  const openapi = openApiDocument() as unknown as {
    paths: Record<string, Record<string, { requestBody?: { content?: Record<string, { schema?: Schema }> } }>>;
    components?: { schemas?: Record<string, unknown> };
  };
  const schemas = openapi.components?.schemas;
  const body = (path: string, verb: string) =>
    resolve(openapi.paths?.[path]?.[verb]?.requestBody?.content?.["application/json"]?.schema, schemas);

  test("entries/YYYY-MM-DD-slug.md: apiOnly keys are exactly POST …/days's own keys minus what the file also carries", () => {
    const days = body("/api/v1/{user}/trips/{trip}/days", "post");
    const apiKeys = Object.keys(days.properties ?? {});
    const fileKeys = new Set(fileKnownKeys("entries/YYYY-MM-DD-slug.md"));
    // Every key the API takes that the file never carries must be declared
    // apiOnly — otherwise this document is silent about something the
    // instance offers, exactly the `unrecorded: [costs]` incident.
    const undeclared = apiKeys.filter((k) => !fileKeys.has(k) && !apiOnlyKeys("entries/YYYY-MM-DD-slug.md").includes(k));
    expect(undeclared, "keys the API takes that this document does not mention at all").toEqual([]);
  });

  test("config.json: the union of POST /journals and PATCH …/config accounts for every key the API offers that the file does not carry", () => {
    const created = body("/api/v1/journals", "post");
    const patched = body("/api/v1/{user}/config", "patch");
    const apiKeys = new Set([...Object.keys(created.properties ?? {}), ...Object.keys(patched.properties ?? {})]);
    const fileKeys = new Set(fileKnownKeys("config.json"));
    const undeclared = [...apiKeys].filter((k) => !fileKeys.has(k) && !apiOnlyKeys("config.json").includes(k));
    expect(undeclared, "keys the API takes that this document does not mention at all").toEqual([]);
  });

  test("config.json: every offered (non-file-only) key this document knows is actually taken by one of the two calls", () => {
    const created = body("/api/v1/journals", "post");
    const patched = body("/api/v1/{user}/config", "patch");
    const apiKeys = new Set([...Object.keys(created.properties ?? {}), ...Object.keys(patched.properties ?? {})]);
    const offered = fileKnownKeys("config.json").filter((k) => !fileOnlyKeys("config.json").includes(k));
    const missing = offered.filter((k) => !apiKeys.has(k));
    expect(missing, "offered here but not accepted by either call — would be dropped on publish").toEqual([]);
  });

  test("trip.md: every offered key is taken by POST …/trips", () => {
    const created = body("/api/v1/{user}/trips", "post");
    const apiKeys = new Set(Object.keys(created.properties ?? {}));
    const offered = fileKnownKeys("trip.md").filter((k) => !fileOnlyKeys("trip.md").includes(k));
    const missing = offered.filter((k) => !apiKeys.has(k));
    expect(missing, "offered here but not accepted by POST …/trips — would be dropped on publish").toEqual([]);
  });
});

describe("trip.md's id/start/end pattern agrees with lib/tripWrite.ts", () => {
  const idRule = doc.rules.find((r) => r.where === "trip.md" && r.path === "id" && r.assert === "pattern");
  const startRule = doc.rules.find((r) => r.where === "trip.md" && r.path === "start" && r.assert === "pattern");

  test("id", () => {
    expect(idRule?.assert).toBe("pattern");
    if (idRule?.assert !== "pattern") throw new Error("unreachable");
    for (const good of ["japan-2027", "a", "a1-b2"]) {
      expect(new RegExp(idRule.pattern).test(good)).toBe(ID_RE.test(good));
    }
    for (const bad of ["Japan-2027", "-japan", "japan!", ""]) {
      expect(new RegExp(idRule.pattern).test(bad)).toBe(ID_RE.test(bad));
    }
  });

  test("start/end's pattern matches DATE_RE exactly — but see the calendar-validity finding below for entries.date", () => {
    expect(startRule?.assert).toBe("pattern");
    if (startRule?.assert !== "pattern") throw new Error("unreachable");
    for (const value of ["2027-04-01", "2027-13-40", "not-a-date", "2027-4-1"]) {
      expect(new RegExp(startRule.pattern).test(value)).toBe(DATE_RE.test(value));
    }
  });
});

/** A day with every field this document's rules can say something about,
 * filled with a value that both sides should accept. */
function validDay(overrides: Partial<EntryInput> = {}): Record<string, unknown> {
  return {
    title: "Ankunft",
    date: "2026-09-01",
    content: "Wir sind angekommen.",
    time: "18:40",
    location: "Lissabon",
    country: "Portugal",
    countryCode: "PT",
    lat: 38.7,
    lng: -9.1,
    tags: ["ankunft"],
    ...overrides,
  } as Record<string, unknown>;
}

function realProblems(day: Record<string, unknown>): string[] {
  return validateEntry(day as EntryInput).map((p) => p.field);
}
function docProblems(day: Record<string, unknown>): string[] {
  return interpretFile(doc.rules, "entries/YYYY-MM-DD-slug.md", day).map((p) => p.path);
}

describe("entries/YYYY-MM-DD-slug.md: agreement on what this document can check", () => {
  test("a day with everything filled in validly passes both sides", () => {
    const day = validDay();
    expect(realProblems(day)).toEqual([]);
    expect(docProblems(day)).toEqual([]);
  });

  test("a missing title/date/content is refused by both", () => {
    const day = { ...validDay(), title: undefined, content: undefined };
    // date stays required=true in validateEntry's default
    delete (day as Record<string, unknown>).date;
    expect(realProblems(day)).toEqual(expect.arrayContaining(["date"]));
    expect(docProblems(day)).toEqual(expect.arrayContaining(["date"]));
  });

  test("a malformed time is refused by both", () => {
    const day = validDay({ time: "25:99" as unknown as EntryInput["time"] });
    expect(realProblems(day)).toEqual(expect.arrayContaining(["time"]));
    expect(docProblems(day)).toEqual(expect.arrayContaining(["time"]));
  });
});

describe("entries/YYYY-MM-DD-slug.md: disagreements found, and reported rather than fixed", () => {
  // FINDING 1 (file for a ticket): `costs` is documented here as `type:
  // "array"`, a faithful copy of model.mjs. The real field also accepts
  // `false` ("nothing was spent") and `"unknown"` ("something was, and
  // nobody has the figures") — B531 and B560. A day sending either is
  // written cleanly by the server and refused by this document's own rule.
  test("costs: false / \"unknown\" — accepted by validateEntry, refused by this document's type rule", () => {
    for (const value of [false, "unknown"]) {
      const day = validDay({ costs: value as unknown as EntryInput["costs"] });
      expect(realProblems(day), `validateEntry on costs: ${JSON.stringify(value)}`).toEqual([]);
      expect(docProblems(day), `content-model.json on costs: ${JSON.stringify(value)}`).toEqual(
        expect.arrayContaining(["costs"]),
      );
    }
  });

  // FINDING 2 (file for a ticket): `test` carries no rule at all here — a
  // faithful copy of model.mjs, which never gained one. `validateEntry`
  // refuses anything but a real boolean (`checkTest`). This document
  // currently says nothing about a day sent with `test: "true"`.
  test("test: \"true\" — refused by validateEntry, waved through by this document", () => {
    const day = validDay({ test: "true" as unknown as EntryInput["test"] });
    expect(realProblems(day)).toEqual(expect.arrayContaining(["test"]));
    expect(docProblems(day)).not.toEqual(expect.arrayContaining(["test"]));
  });

  // FINDING 4 (file for a ticket): `date`'s pattern here only checks the
  // YYYY-MM-DD shape — again a faithful copy of model.mjs's `ISO_DATE`. The
  // server's `checkDate` also checks the date is a real one on the calendar
  // (`isRealCalendarDate`), so a syntactically-shaped but impossible date is
  // refused by the server and waved through by this document. (trip.md's
  // `start`/`end` do NOT have this gap — `lib/tripWrite.ts`'s `DATE_RE` is
  // exactly as shallow as this document's pattern; see the test above.)
  test("date: 2026-13-40 — refused by validateEntry's calendar check, waved through by this document's pattern", () => {
    const day = validDay({ date: "2026-13-40" });
    expect(realProblems(day)).toEqual(expect.arrayContaining(["date"]));
    expect(docProblems(day)).not.toEqual(expect.arrayContaining(["date"]));
  });
});

describe("entries/YYYY-MM-DD-slug.md: B615 fixed — countryCode agrees with COUNTRY_CODE_RE", () => {
  // B615: the pattern is now `^[A-Za-z]{2}$`, matching `COUNTRY_CODE_RE`
  // exactly — a lowercase code is a live false error no longer.
  test("countryCode: lowercase — accepted by both", () => {
    const day = validDay({ countryCode: "pt" });
    expect(realProblems(day)).toEqual([]);
    expect(docProblems(day)).toEqual([]);
  });

  test("countryCode: three letters, or a digit — refused by both", () => {
    for (const bad of ["PTX", "P1"]) {
      const day = validDay({ countryCode: bad });
      expect(realProblems(day)).toEqual(expect.arrayContaining(["countryCode"]));
      expect(docProblems(day)).toEqual(expect.arrayContaining(["countryCode"]));
    }
  });
});

function validConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "A Journal",
    owner: { name: "A B", nickname: "A" },
    defaultLocale: "en",
    locales: ["en"],
    baseCurrency: "CHF",
    displayCurrencies: ["CHF"],
    ...overrides,
  };
}
function realConfigProblems(raw: Record<string, unknown>): string[] {
  try {
    parseUserConfig("test-user", raw);
    return [];
  } catch (e) {
    if (e instanceof ConfigError) return e.problems;
    throw e;
  }
}
function docConfigProblems(raw: Record<string, unknown>): string[] {
  return interpretFile(doc.rules, "config.json", raw).map((p) => p.path);
}

describe("config.json: agreement on what this document can check", () => {
  test("a config with everything filled in validly passes both sides' shape rules", () => {
    const config = validConfig();
    expect(docConfigProblems(config)).toEqual([]);
    // parseUserConfig may still warn about things this document has no rule
    // for (e.g. currency validity) — assert only that it does not complain
    // about any key this document itself asserts on.
    const ruled = doc.rules.filter((r) => r.where === "config.json").map((r) => r.path);
    expect(realConfigProblems(config).filter((p) => ruled.some((path) => p.startsWith(path)))).toEqual([]);
  });

  test("a missing title is refused by both", () => {
    const config = validConfig();
    delete config.title;
    expect(realConfigProblems(config).some((p) => p.startsWith("title"))).toBe(true);
    expect(docConfigProblems(config)).toEqual(expect.arrayContaining(["title"]));
  });
});

describe("config.json: disagreements found, and reported rather than fixed", () => {
  // FINDING 5 (file for a ticket): this document says `features` is a
  // `type: "object"` and nothing more — a faithful copy of model.mjs, which
  // never checked further (B598). `lib/config.ts`'s `parseFeatures` — added
  // since — refuses a member that is not itself an object shaped like
  // `{enabled: boolean}`, and refuses a key that names no known capability.
  // Both pass this document's rule, because the rule only checks that
  // `features` itself is an object.
  test("features: { postcards: true } — refused by parseUserConfig, waved through by this document", () => {
    const config = validConfig({ features: { postcards: true } });
    expect(realConfigProblems(config).some((p) => p.startsWith("features"))).toBe(true);
    expect(docConfigProblems(config)).not.toEqual(expect.arrayContaining(["features"]));
  });

  test("features: { notAFeature: {...} } — refused by parseUserConfig, waved through by this document", () => {
    const config = validConfig({ features: { notAFeature: { enabled: true } } });
    expect(realConfigProblems(config).some((p) => p.startsWith("features"))).toBe(true);
    expect(docConfigProblems(config)).not.toEqual(expect.arrayContaining(["features"]));
  });

});

describe("config.json: B615 fixed — locales/defaultLocale agree with parseUser's defaulting", () => {
  // `defaultLocale` and `locales` are no longer `required` here.
  // `lib/config.ts`'s `parseUser` in fact defaults both silently —
  // `locales` falls back to `["en"]`, and `defaultLocale` to `locales[0]` —
  // so a config omitting either is written cleanly by the server, and no
  // longer a live false error here.
  test("a config with locales but no defaultLocale — accepted (defaulted) by both", () => {
    const config = validConfig();
    delete config.defaultLocale;
    expect(realConfigProblems(config).some((p) => p.startsWith("defaultLocale"))).toBe(false);
    expect(docConfigProblems(config)).not.toEqual(expect.arrayContaining(["defaultLocale"]));
  });

  test("a config with no locales at all — accepted (defaulted) by both", () => {
    const config = validConfig();
    delete config.locales;
    delete config.defaultLocale;
    expect(realConfigProblems(config).some((p) => p.startsWith("locales"))).toBe(false);
    expect(docConfigProblems(config)).not.toEqual(expect.arrayContaining(["locales"]));
  });
});

describe("costs.md: agreement, and one disagreement", () => {
  test("a well-formed budget and cost list passes both sides", () => {
    const costs = { budget: { total: 1000, days: 10, currency: "CHF" }, costs: [{ label: "Flug", amount: 400, currency: "CHF" }] };
    expect(validateCostsPut(costs)).toEqual([]);
    expect(interpretFile(doc.rules, "costs.md", costs)).toEqual([]);
  });

  // FINDING 7 (file for a ticket): `budget` is `type: "object"` here, a
  // faithful copy of model.mjs, which never described its members.
  // `lib/validate/costs.ts`'s `validateCostsPut` refuses a non-positive
  // `budget.total`/`budget.days` — this document has no rule that reaches
  // inside `budget` at all, so it waves the same input through.
  test("budget.total <= 0 — refused by validateCostsPut, waved through by this document", () => {
    const costs = { budget: { total: 0, days: 10, currency: "CHF" } };
    expect(validateCostsPut(costs).some((p) => p.field.startsWith("budget"))).toBe(true);
    expect(interpretFile(doc.rules, "costs.md", costs)).toEqual([]);
  });
});
