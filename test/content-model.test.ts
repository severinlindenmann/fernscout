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
 * `lib/contentModel/document.ts`). Fixed so far, in `content-model.json`
 * rather than in `lib/validate/*` (that stays the server's own gate, per
 * W41):
 *
 * - B615: `countryCode`'s case-sensitivity, and `locales`/`defaultLocale`
 *   being wrongly `required`.
 * - B616: impossible calendar dates, `features` member shape, and
 *   non-positive `budget.total`/`budget.days`. Two of the three fit the
 *   vocabulary's existing eight kinds (`features`, via `shape` and
 *   `known-key`); the calendar check and the budget range do not, and are
 *   declared as named checks instead of left silent.
 *
 * B617 went the other way: two of the seven original findings — `costs` and
 * `test` — were never drift at all. `test` already carries `type: "boolean"`
 * on both files that hold it (fixed in passing by B616) and is a key a file
 * may deliberately carry, same as the wire. `costs` is genuinely one thing on
 * disk (`type: "array"`, or `without`/`unrecorded` beside it) and another on
 * the wire (that array, or `false`/`"unknown"` in the same field) *by
 * design* — the file/wire boundary the whole test was comparing across
 * without saying so. `toWire`, below, is the mapping a publishing client
 * applies to cross it; every assertion about `costs` in this file runs
 * through it before comparing, and once it does, both sides agree.
 *
 * With those two accounted for, no disagreement asserted as unresolved
 * remains in this file — every describe block below is either an agreement,
 * a documented named-check gap, or a regression guard for a fixed ticket.
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

  // B1389: the direction above (docs→API) is the one this file had, and it
  // could not have caught `teaser` — a key absent from *both* lists agrees
  // with itself. The missing direction is API→docs: every key POST …/trips
  // actually takes must be in trip.md's known keys, in apiOnlyKeys, or
  // (B1389's own fix aside) this document is silently behind the route it
  // claims to describe.
  //
  // PUT …/trips/{trip}/visibility is deliberately not fed into this check:
  // it only amends `visibility`/`listed`/`teaser`/`status`/`costsVisibility`,
  // keys POST …/trips already accepts, so today this crosscheck would find
  // nothing there that the create route does not already cover.
  test("trip.md: every key POST …/trips takes is known to this document", () => {
    const created = body("/api/v1/{user}/trips", "post");
    const apiKeys = Object.keys(created.properties ?? {});
    const fileKeys = new Set(fileKnownKeys("trip.md"));
    const undeclared = apiKeys.filter((k) => !fileKeys.has(k) && !apiOnlyKeys("trip.md").includes(k));
    expect(undeclared, "keys POST …/trips takes that this document does not mention at all").toEqual([]);
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

/**
 * The one translation a publishing client is allowed to make between a file
 * and the wire — see W41's "The only thing publish takes from the manifest".
 * `without: [x]` becomes `x: false` ("nothing was spent"); `unrecorded: [x]`
 * becomes `x: "unknown"` ("something was, and nobody has the figures"). This
 * server's own day-write path applies the identical mapping in the other
 * direction (`declinedIn`/`unrecordedIn` and `withoutLine`/`unrecordedLine`
 * in `lib/api/entries.ts`), which is what makes it the contract rather than
 * a guess.
 *
 * `content-model.json` describes the *file*, so a rule like `costs: {type:
 * "array"}` is only ever comparable to `validateEntry` — which describes the
 * *wire* — after this runs. Before it, `costs: false` is not a value either
 * side disagrees about; it is a value only one side's vocabulary can even
 * hold — B617.
 */
function toWire(fileDay: Record<string, unknown>): Record<string, unknown> {
  const wire = { ...fileDay };
  const without = Array.isArray(wire.without) ? (wire.without as string[]) : [];
  const unrecorded = Array.isArray(wire.unrecorded) ? (wire.unrecorded as string[]) : [];
  delete wire.without;
  delete wire.unrecorded;
  for (const key of without) wire[key] = false;
  for (const key of unrecorded) wire[key] = "unknown";
  return wire;
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

describe("entries/YYYY-MM-DD-slug.md: costs — B617 fixed, mapped across the file/wire boundary before comparing", () => {
  // Not a disagreement: `costs` is documented here as `type: "array"`,
  // correct for a *file* — a file never carries `costs: false`, it says
  // `without: [costs]` (`unrecorded: [costs]` for `"unknown"`) — B531 and
  // B560. Comparing the document's rule straight against `validateEntry`,
  // which only ever sees the wire shape, was comparing two different
  // questions. Run `toWire` first, as a publishing client does, and the two
  // sides agree.
  test("without: [costs] / unrecorded: [costs] on the file — a day with everything else valid passes this document as-is", () => {
    for (const key of ["without", "unrecorded"] as const) {
      const fileDay = validDay({ [key]: ["costs"] });
      expect(docProblems(fileDay), `content-model.json on ${key}: [costs]`).toEqual([]);
    }
  });

  test("…and once mapped to the wire shape it becomes, validateEntry accepts it too", () => {
    for (const [key, expectedWire] of [
      ["without", false],
      ["unrecorded", "unknown"],
    ] as const) {
      const fileDay = validDay({ [key]: ["costs"] });
      const wireDay = toWire(fileDay);
      expect(wireDay.costs, `toWire's costs for ${key}: [costs]`).toBe(expectedWire);
      expect(realProblems(wireDay), `validateEntry on costs: ${JSON.stringify(expectedWire)}`).toEqual([]);
    }
  });
});

describe("entries/YYYY-MM-DD-slug.md: B616 fixed — test's type, and the date gap declared rather than silent", () => {
  // B616: `test` now has `type: "boolean"`, so validateEntry's `checkTest`
  // and this document agree.
  test("test: \"true\" — refused by both", () => {
    const day = validDay({ test: "true" as unknown as EntryInput["test"] });
    expect(realProblems(day)).toEqual(expect.arrayContaining(["test"]));
    expect(docProblems(day)).toEqual(expect.arrayContaining(["test"]));
  });

  test("test: true / false — accepted by both", () => {
    for (const value of [true, false]) {
      const day = validDay({ test: value });
      expect(realProblems(day)).toEqual([]);
      expect(docProblems(day)).toEqual([]);
    }
  });

  // B616: an impossible calendar date is real Date arithmetic
  // (isRealCalendarDate), which no `pattern` in this vocabulary can express
  // without re-deriving leap years — the ticket's explicit instruction not
  // to. So this is declared as a named check instead of silently missed;
  // see the "named checks" describe below for the assertion that it exists.
  // The server-side behaviour itself is unchanged and still asserted here.
  test("date: 2026-13-40 — refused by validateEntry's calendar check (server behaviour, unaffected by this document)", () => {
    const day = validDay({ date: "2026-13-40" });
    expect(realProblems(day)).toEqual(expect.arrayContaining(["date"]));
  });

  test("trip.md's start/end shallow-pattern behaviour is unchanged by B616 — 2026-13-40 still matches the shape", () => {
    // Same assertion as the "trip.md's id/start/end pattern" describe above,
    // repeated here as a regression guard specific to B616: fixing the day's
    // calendar gap must not touch trip.md's deliberately shallow pattern.
    const startRule = doc.rules.find((r) => r.where === "trip.md" && r.path === "start" && r.assert === "pattern");
    expect(startRule?.assert).toBe("pattern");
    if (startRule?.assert !== "pattern") throw new Error("unreachable");
    expect(new RegExp(startRule.pattern).test("2026-13-40")).toBe(DATE_RE.test("2026-13-40"));
    expect(DATE_RE.test("2026-13-40")).toBe(true); // shallow on both sides, deliberately
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

describe("config.json: B616 fixed — features member shape agrees with parseFeatures", () => {
  // `features.*` now has a `shape` rule ({enabled: boolean}) and `features` a
  // `known-key` rule (against FEATURE_NAMES, imported from lib/config.ts so
  // the two lists cannot drift apart) — reconciling with what B598 already
  // put in `parseFeatures`, rather than writing a second copy of the
  // capability list here.
  test("features: { postcards: true } — refused by both", () => {
    const config = validConfig({ features: { postcards: true } });
    expect(realConfigProblems(config).some((p) => p.startsWith("features"))).toBe(true);
    expect(docConfigProblems(config).some((p) => p.startsWith("features"))).toBe(true);
  });

  test("features: { notAFeature: {...} } — refused by both", () => {
    const config = validConfig({ features: { notAFeature: { enabled: true } } });
    expect(realConfigProblems(config).some((p) => p.startsWith("features"))).toBe(true);
    expect(docConfigProblems(config).some((p) => p.startsWith("features"))).toBe(true);
  });

  test("features: { mail: { enabled: true } } — a well-formed, known member passes both", () => {
    const config = validConfig({ features: { mail: { enabled: true } } });
    expect(realConfigProblems(config).some((p) => p.startsWith("features"))).toBe(false);
    expect(docConfigProblems(config).some((p) => p.startsWith("features"))).toBe(false);
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

  // B616: `validateCostsPut` refuses a non-positive `budget.total`/
  // `budget.days`, and no `assert` kind in this vocabulary expresses a
  // numeric range (only `type`/`enum`/`pattern`/`shape`/`known-key`, none of
  // which reach "greater than zero"). So rather than leaving the document
  // silently claiming `budget: { type: "object" }` is the whole story, it
  // *declares* the gap as a named check — asserted just below — which is
  // the agreement this vocabulary can offer: honest about what it cannot
  // check, instead of quietly wrong about it.
  test("budget.total <= 0 / budget.days < 0 — refused by validateCostsPut (server behaviour, unaffected by this document)", () => {
    expect(validateCostsPut({ budget: { total: 0, days: 10, currency: "CHF" } }).some((p) => p.field.startsWith("budget"))).toBe(true);
    expect(validateCostsPut({ budget: { total: 1000, days: -1, currency: "CHF" } }).some((p) => p.field.startsWith("budget"))).toBe(true);
  });

  test("the gap is declared, not silent: a named check for budget positivity exists", () => {
    const namedIds = doc.named.map((n) => n.id);
    expect(namedIds).toContain("budget-total-and-days-are-positive");
  });
});

describe("named checks this document declares for what B616 could not express in the eight kinds", () => {
  test("entry-date-is-a-real-calendar-date and budget-total-and-days-are-positive are both declared, with prose", () => {
    for (const id of ["entry-date-is-a-real-calendar-date", "budget-total-and-days-are-positive"]) {
      const named = doc.named.find((n) => n.id === id);
      expect(named, id).toBeDefined();
      expect(named?.because.length ?? 0, id).toBeGreaterThan(0);
    }
  });
});

describe("B620: test is never offered as a tip, cover and travellers carry theirs", () => {
  test("test is suppressed on both files that carry it", () => {
    expect(doc.files["trip.md"].noTip).toContain("test");
    expect(doc.files["entries/YYYY-MM-DD-slug.md"].noTip).toContain("test");
  });

  test("no other key is suppressed — model.mjs marks noTip in exactly these two places", () => {
    const suppressed = (Object.entries(doc.files) as [FileName, (typeof doc.files)[FileName]][])
      .flatMap(([where, f]) => (f.noTip ?? []).map((key) => `${where}:${key}`));
    expect(suppressed.sort()).toEqual(["entries/YYYY-MM-DD-slug.md:test", "trip.md:test"].sort());
  });

  // cover (trip.md) was the one `fileOnly` key left with real tip prose in
  // model.mjs and no `openapi.json` field description to borrow one from at
  // run time. config.json's `travellers` used to be its companion here —
  // B1526 gave it an API door (`PATCH …/config`, `GET …/travellers`), so it
  // is no longer `fileOnly` and no longer needs prose carried in this file:
  // a caller now borrows its tip from openapi.json's own field description,
  // the same as every other non-fileOnly key.
  test("cover (trip.md) carries tip prose on its never-over-api rule", () => {
    const coverRule = doc.rules.find((r) => r.where === "trip.md" && r.path === "cover" && r.assert === "never-over-api");
    expect(coverRule?.because?.length ?? 0).toBeGreaterThan(0);
  });

  test("travellers (config.json) is no longer fileOnly, since B1526 gave it an API door", () => {
    const travellersRule = doc.rules.find((r) => r.where === "config.json" && r.path === "travellers" && r.assert === "never-over-api");
    expect(travellersRule).toBeUndefined();
  });

  test("every other fileOnly (never-over-api) key is unchanged from before B620", () => {
    // model.mjs's fileOnly keys with a `tip` (as opposed to only a `note`)
    // were config.json's travellers and trip.md's cover — B1526 removed
    // travellers from that list by giving it an API door, so trip.md's cover
    // is the only one left. entries' `status` already carried a `because`
    // before this ticket (its always-shown "publishing is a separate call"
    // prose, unaffected by B620); the rest carry none, same as model.mjs's
    // own `note`-only or bare fileOnly keys.
    const withProse = doc.rules
      .filter((r) => r.assert === "never-over-api" && (r.because?.length ?? 0) > 0)
      .map((r) => `${r.where}:${r.path}`);
    expect(withProse.sort()).toEqual(
      ["trip.md:cover", "entries/YYYY-MM-DD-slug.md:status"].sort(),
    );
  });
});
