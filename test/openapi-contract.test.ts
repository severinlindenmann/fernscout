import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openApiDocument } from "@/lib/api/openapi";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { COST_CATEGORIES } from "@/lib/costFormat";
import { FEATURE_NAMES } from "@/lib/config";
import { TRACKS } from "@/lib/tracks";
import { VISIBILITIES } from "@/lib/tripWrite";
import { TRANSPORT_MODES, TRAVEL_SCENE_VARIANTS } from "@/lib/validate/entry";
import { IMAGE_FORMATS, VIDEO_FORMATS } from "@/lib/validate/media";

/**
 * B540: the document at /openapi.json is the only thing an agent working
 * over the network ever reads about this API — it never sees lib/validate,
 * never sees the route handler, never sees a comment explaining why a field
 * is refused. `test/api-route-schemas.test.ts` already checks that a route
 * which reads a body publishes *a* schema for it. This file checks the
 * things that test does not: that every route exists in the document at
 * all, that the values the document allows are the same values the server
 * actually accepts, that no operation answers with nothing, and that a
 * schema's own `required` list does not name a field the schema forgot to
 * describe. A document that passes this file and is still wrong is a
 * document lying about something this file does not yet know to check —
 * not a reason to relax what it does check.
 */

type Operation = {
  requestBody?: {
    content?: Record<string, { schema?: unknown }>;
  };
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
  /** `[]` means "no credential asked for" — see the 4xx rule below. */
  security?: unknown[];
};
type Document = {
  paths: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, unknown> };
};

const document = openApiDocument() as unknown as Document;

const VERB_RE = /export async function (GET|POST|PATCH|PUT|DELETE)\b/g;

function routeFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) routeFiles(path, found);
    else if (entry === "route.ts") found.push(path);
  }
  return found;
}

/**
 * `app/api/v1/[user]/trips/route.ts` → `/api/v1/{user}/trips`.
 *
 * A catch-all segment collapses to the same shape: `[...path]` → `{path}`,
 * which is how OpenAPI spells a parameter that happens to contain slashes.
 * B1495's `sync/file/[...path]` is the first one under `/api/v1`, and without
 * this the document could only match it by naming the literal `[...path]` —
 * a path no caller would ever read as a parameter.
 */
function openApiPath(file: string): string {
  return (
    "/" +
    file
      .slice("app/".length, -"/route.ts".length)
      .replace(/\[\.\.\.(\w+)\]/g, "{$1}")
      .replace(/\[(\w+)\]/g, "{$1}")
  );
}

/**
 * Every `path verb` pair this route file exports, exactly as the document
 * would need to name them to describe it.
 */
function routeVerbs(file: string): string[] {
  const path = openApiPath(file);
  const source = readFileSync(file, "utf8");
  const verbs = [...source.matchAll(VERB_RE)].map((m) => m[1].toLowerCase());
  return verbs.map((verb) => `${path} ${verb}`);
}

/**
 * Doors this document deliberately does not describe, because they are not
 * doors an agent walks through — they are cookie-and-browser flows the site
 * itself calls, never something read from `/agent.md` or `/openapi.json`.
 * Naming them here, rather than filtering them out silently, is the point:
 * a new route under one of these prefixes is a choice for whoever adds it to
 * make again, not a filter it falls through by accident.
 */
const OUT_OF_SCOPE_PREFIXES = [
  "/api/contacts", // the owner's own contacts page, cookie session only
  "/api/push", // web push subscription management, browser only
  "/api/reactions", // reader reactions on a public page, no credential at all
  "/api/address-lookup", // an autocomplete the owner's own forms call
  "/api/md", // markdown rendering for the site's own pages
  // Identity and sign-out are the browser's half of authentication: they set
  // and clear cookies, and `resolveSession` refuses an identity row to every
  // gate an agent passes through. Documenting them here would invite an agent
  // to call something it cannot authenticate with, and cannot use if it did.
  "/api/auth/identity",
  "/api/auth/logout",
  "/api/v1/me", // the reader's own devices and home, identity cookie only
];

/**
 * Routes that exist only to answer a wrong guess in words.
 *
 * `PATCH /api/v1/{user}` is the natural guess for "change something about
 * this journal", and answers 405 with a sentence naming the real door (B293).
 * It is deliberately absent from the document: an operation here would
 * advertise it as something to call, which is the opposite of what it is for.
 *
 * `PATCH /api/v1/{user}/trips/{trip}` was the other one and is no longer a
 * signpost — B622 gave it the four fields it had been apologising for not
 * having, so it is now an operation like any other and is documented.
 */
const SIGNPOSTS = ["/api/v1/{user} patch"];

function inScope(path: string): boolean {
  return !OUT_OF_SCOPE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

const codeVerbs = new Set(
  [...routeFiles("app/api/v1"), ...routeFiles("app/api/auth")]
    .flatMap(routeVerbs)
    .filter((entry) => inScope(entry.split(" ")[0]))
    .filter((entry) => !SIGNPOSTS.includes(entry)),
);

const documentedVerbs = new Set(
  Object.entries(document.paths).flatMap(([path, verbs]) => Object.keys(verbs).map((verb) => `${path} ${verb}`)),
);

describe("coverage: every route+verb the code answers to is in the document", () => {
  test("the walk found routes at all", () => {
    // If this is empty the walk is broken and every assertion below would
    // pass by describing an empty API.
    expect(codeVerbs.size).toBeGreaterThan(10);
  });

  test("no route+verb pair the code exports is missing from openApiDocument().paths", () => {
    const missing = [...codeVerbs].filter((entry) => !documentedVerbs.has(entry)).sort();
    expect(missing).toEqual([]);
  });

  test("no route+verb pair in the document has stopped existing in the code", () => {
    // The document is public, and this side would only fail if a route was
    // deleted (or moved) without its documentation following — a promise
    // to an agent about a door that is no longer there. Scoped to
    // /api/v1 and /api/auth, the same as the walk above: the document also
    // describes the `/{user}/day/{slug}.md` markdown-source routes, which
    // live under app/[user]/ rather than app/api and are not this walk's to
    // check.
    const stale = [...documentedVerbs]
      .filter((entry) => /^\/api\/(v1|auth)\//.test(entry))
      .filter((entry) => inScope(entry.split(" ")[0]))
      .filter((entry) => !codeVerbs.has(entry))
      .sort();
    expect(stale).toEqual([]);
  });
});

/** Every schema object anywhere in a `requestBody`, keyed by where it lives. */
function requestBodySchemas(): Array<{ where: string; schema: Record<string, unknown> }> {
  const found: Array<{ where: string; schema: Record<string, unknown> }> = [];
  for (const [path, verbs] of Object.entries(document.paths)) {
    for (const [verb, operation] of Object.entries(verbs)) {
      const content = operation.requestBody?.content;
      if (!content) continue;
      for (const [mediaType, media] of Object.entries(content)) {
        if (media.schema) {
          found.push({ where: `${verb.toUpperCase()} ${path} (${mediaType})`, schema: media.schema as Record<string, unknown> });
        }
      }
    }
  }
  return found;
}

/** Recursively collects every `enum` array anywhere in a value, deepest first. */
function enumsIn(value: unknown, found: unknown[][] = []): unknown[][] {
  if (Array.isArray(value)) {
    for (const item of value) enumsIn(item, found);
  } else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === "enum" && Array.isArray(v)) found.push(v);
      else enumsIn(v, found);
    }
  }
  return found;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

describe("enums match their source", () => {
  // Draft is the body of POST .../days; DayEdit is PATCH .../days/{slug}.
  // Both accept transportMode, and both must offer exactly the modes
  // checkTransportMode actually validates against — not a story an agent
  // could not have discovered any other way, since /agent.md is prose and
  // TRANSPORT_MODES is the only place this list is enforced.
  test("Draft.transportMode enum equals TRANSPORT_MODES", () => {
    const schemas = document.components?.schemas as Record<string, { properties?: Record<string, { enum?: string[] }> }>;
    expect(sorted(schemas.Draft.properties!.transportMode.enum ?? [])).toEqual(sorted(TRANSPORT_MODES));
  });

  test("DayEdit.transportMode enum equals TRANSPORT_MODES", () => {
    const schemas = document.components?.schemas as Record<string, { properties?: Record<string, { enum?: string[] }> }>;
    expect(sorted(schemas.DayEdit.properties!.transportMode.enum ?? [])).toEqual(sorted(TRANSPORT_MODES));
  });

  test("Draft.travelScene enum equals TRAVEL_SCENE_VARIANTS", () => {
    const schemas = document.components?.schemas as Record<string, { properties?: Record<string, { enum?: string[] }> }>;
    expect(sorted(schemas.Draft.properties!.travelScene.enum ?? [])).toEqual(sorted(TRAVEL_SCENE_VARIANTS));
  });

  test("DayEdit.travelScene enum equals TRAVEL_SCENE_VARIANTS", () => {
    const schemas = document.components?.schemas as Record<string, { properties?: Record<string, { enum?: string[] }> }>;
    expect(sorted(schemas.DayEdit.properties!.travelScene.enum ?? [])).toEqual(sorted(TRAVEL_SCENE_VARIANTS));
  });

  test("Cost.category enum equals COST_CATEGORIES", () => {
    const schemas = document.components?.schemas as Record<string, { properties?: Record<string, { enum?: string[] }> }>;
    expect(sorted(schemas.Cost.properties!.category.enum ?? [])).toEqual(sorted(COST_CATEGORIES));
  });

  // TRACKS is not offered as an `enum` — it names the rows, so the document
  // publishes one boolean property per row instead. What must match is the
  // set of property names, on both the endpoint that turns a row on or off
  // and the one that sets which rows a brand-new trip starts with.
  test("PATCH .../trips/{trip}/tracks names exactly TRACKS as tracks.properties", () => {
    const operation = document.paths["/api/v1/{user}/trips/{trip}/tracks"]?.patch;
    const body = operation?.requestBody?.content?.["application/json"]?.schema as
      | { properties?: { tracks?: { properties?: Record<string, unknown> } } }
      | undefined;
    const properties = body?.properties?.tracks?.properties ?? {};
    expect(sorted(Object.keys(properties))).toEqual(sorted(TRACKS));
  });

  test("POST .../trips names exactly TRACKS as tracks.properties, so a trip can be created with rows already off", () => {
    const operation = document.paths["/api/v1/{user}/trips"]?.post;
    const body = operation?.requestBody?.content?.["application/json"]?.schema as
      | { properties?: { tracks?: { properties?: Record<string, unknown> } } }
      | undefined;
    const properties = body?.properties?.tracks?.properties ?? {};
    expect(sorted(Object.keys(properties))).toEqual(sorted(TRACKS));
  });

  // FEATURE_NAMES is not an enum either — `features` is a map from
  // capability name to boolean, so the document names the capabilities the
  // same way it names tracks: one boolean property per name. An
  // `additionalProperties: boolean` with nothing else is indistinguishable,
  // to an agent, from "any string works" — which is not true, and is
  // exactly the gap checkFeatures refuses on the server side.
  test("PATCH .../config names exactly FEATURE_NAMES as features.properties", () => {
    const operation = document.paths["/api/v1/{user}/config"]?.patch;
    const body = operation?.requestBody?.content?.["application/json"]?.schema as
      | { properties?: { features?: { properties?: Record<string, unknown> } } }
      | undefined;
    const properties = body?.properties?.features?.properties ?? {};
    expect(sorted(Object.keys(properties))).toEqual(sorted(FEATURE_NAMES));
  });

  /**
   * What may be uploaded is published on /api/health rather than on the media
   * endpoint itself, and the reason is the order things happen in: a client
   * needs to know the formats *before* it sends 60 MB, and health is the call
   * it already makes first. The helper tools carried their own copy of these
   * lists until B540, drifted (they offered `jpg` and `avif`, neither of which
   * this server takes), and found out when a batch was refused half-way.
   */
  const healthSchema = document.paths["/api/health"]?.get?.responses?.["200"]?.content?.[
    "application/json"
  ]?.schema as { properties?: { media?: { properties?: Record<string, { items?: { enum?: string[] } }> } } } | undefined;
  const healthMedia = healthSchema?.properties?.media?.properties ?? {};

  test("/api/health publishes IMAGE_FORMATS as a literal enum", () => {
    expect(sorted(healthMedia.imageFormats?.items?.enum ?? [])).toEqual(sorted(IMAGE_FORMATS));
  });

  test("/api/health publishes VIDEO_FORMATS as a literal enum", () => {
    expect(sorted(healthMedia.videoFormats?.items?.enum ?? [])).toEqual(sorted(VIDEO_FORMATS));
  });

  test("/api/health publishes every upload limit, not only the formats", () => {
    // A format list without the sizes is half an answer: the limit a batch of
    // phone originals meets first is the whole-request one, not the per-file.
    expect(sorted(Object.keys(healthMedia))).toEqual(
      sorted([
        "imageFormats",
        "videoFormats",
        "imageMaxBytes",
        "imageMaxEdge",
        "videoMaxBytes",
        "videoMaxSeconds",
        "itemsPerDay",
        "requestMaxBytes",
        "captionMaxChars",
      ]),
    );
  });

  test("POST .../trips visibility enum equals VISIBILITIES", () => {
    const operation = document.paths["/api/v1/{user}/trips"]?.post;
    const body = operation?.requestBody?.content?.["application/json"]?.schema as
      | { properties?: { visibility?: { enum?: string[] } } }
      | undefined;
    expect(sorted(body?.properties?.visibility?.enum ?? [])).toEqual(sorted(VISIBILITIES));
  });

  test("PATCH .../trips/{trip}/visibility enum equals VISIBILITIES", () => {
    const operation = document.paths["/api/v1/{user}/trips/{trip}/visibility"]?.patch;
    const body = operation?.requestBody?.content?.["application/json"]?.schema as
      | { properties?: { visibility?: { enum?: string[] } } }
      | undefined;
    expect(sorted(body?.properties?.visibility?.enum ?? [])).toEqual(sorted(VISIBILITIES));
  });
});

describe("no empty responses", () => {
  const operations = Object.entries(document.paths).flatMap(([path, verbs]) =>
    Object.entries(verbs).map(([verb, operation]) => ({ where: `${verb.toUpperCase()} ${path}`, operation })),
  );

  test("there are operations to check", () => {
    expect(operations.length).toBeGreaterThan(10);
  });

  test("every documented operation has at least one response", () => {
    // A `responses: {}` — or no `responses` key at all — describes an
    // endpoint that never tells an agent what it might get back, which is
    // not meaningfully different from the endpoint not being in the
    // document at all.
    const empty = operations
      .filter(({ operation }) => Object.keys(operation.responses ?? {}).length === 0)
      .map(({ where }) => where);
    expect(empty).toEqual([]);
  });

  test("every operation with a requestBody or a non-2xx-only nature documents at least one 4xx", () => {
    // Every route that asks for a credential can be called wrong — a bad
    // token, a missing field, a trip that does not exist — so an operation
    // with no 4xx at all has described only the happy path, which is the half
    // an agent does not need help with.
    //
    // `security: []` marks the handful that ask for nothing and therefore
    // refuse nobody: /api/health answers 200 or 503 and has no 4xx to
    // document, and inventing one for it would be describing a response the
    // server cannot send.
    const withoutRefusal = operations
      .filter(({ operation }) => !(Array.isArray(operation.security) && operation.security.length === 0))
      .filter(({ operation }) => {
        const codes = Object.keys(operation.responses ?? {});
        return !codes.some((code) => /^4\d\d$/.test(code));
      })
      .map(({ where }) => where);
    expect(withoutRefusal).toEqual([]);
  });
});

describe("required fields are real", () => {
  test("every requestBody schema's `required` array names only fields present in `properties`", () => {
    const problems: string[] = [];
    for (const { where, schema } of requestBodySchemas()) {
      const required = (schema as { required?: string[] }).required ?? [];
      const properties = (schema as { properties?: Record<string, unknown> }).properties ?? {};
      for (const field of required) {
        if (!(field in properties)) {
          problems.push(`${where}: required "${field}" is not in properties`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

/**
 * The error vocabulary.
 *
 * An agent that gets `{"error": "unsupported_field"}` and can look the word up
 * knows what to do; one that cannot is left to guess, and a weak model guesses
 * badly. 139 of the 149 places this API returns a code returned one the
 * document had never mentioned, which is what these two tests exist to stop
 * happening again — in both directions, because a catalogue with entries
 * nothing answers is a catalogue nobody trusts.
 */
describe("every error code a route answers with is published", () => {
  // The routes, and the modules whose `error` string a route passes through
  // verbatim — `createTrip` answers `invalid_travellers` and the route hands
  // it on unchanged, so the word reaches a caller from there just as surely.
  const SPEAKS_TO_CALLERS = [
    "lib/tripWrite.ts",
    "lib/api/costs.ts",
    "lib/api/entries.ts",
    "lib/api/tripParty.ts",
    "lib/api/tripDetails.ts",
    "lib/api/tripRates.ts",
    "lib/api/tripVisibility.ts",
    "lib/api/media.ts",
    // B671: the import route answers with `error: result.refusal`, and the
    // refusal words are written here — the same "reaches a caller through a
    // variable" case the list above exists for.
    "lib/gps/api.ts",
  ];
  const answered = new Set<string>();
  /** Every quoted string in those files, for the "nothing here is dead" check
   * below: a code can reach a caller through a variable, and asking whether
   * the word appears at all is the honest question in that direction. */
  const spoken = new Set<string>();
  for (const file of [
    ...routeFiles("app/api/v1"),
    ...routeFiles("app/api/auth"),
    // B1608: v2 routes answer with `incomplete` and `stale_document`, which
    // no v1 route or SPEAKS_TO_CALLERS module ever does — without this,
    // "documented and never returned" would flag both as dead the moment
    // they left `V2_ONLY_CODES` and joined `ERROR_CODES` for real.
    ...routeFiles("app/api/v2"),
    ...SPEAKS_TO_CALLERS,
  ]) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/error:\s*"([a-z_]+)"/g)) answered.add(match[1]);
    for (const match of source.matchAll(/"([a-z_]+)"/g)) spoken.add(match[1]);
  }

  test("the walk found codes at all", () => {
    expect(answered.size).toBeGreaterThan(30);
  });

  test("is in ERROR_CODES, so an agent can look it up", () => {
    const missing = [...answered].filter((code) => !(code in ERROR_CODES)).sort();
    expect(
      missing,
      `add these to lib/api/errorCodes.ts, saying what to do about each: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  test("and nothing in ERROR_CODES is answered by no route", () => {
    const dead = Object.keys(ERROR_CODES).filter((code) => !spoken.has(code)).sort();
    expect(dead, `documented and never returned: ${dead.join(", ")}`).toEqual([]);
  });

  test("reaches the document as the Error schema's enum", () => {
    const schema = document.components?.schemas?.Error as { properties?: { error?: { enum?: string[] } } };
    expect(sorted(schema?.properties?.error?.enum ?? [])).toEqual(sorted(Object.keys(ERROR_CODES)));
  });
});

/**
 * Every field of the three calls that build a journal says what it is.
 *
 * The guide renders these descriptions as the field table an agent checks its
 * body against, and a field with none renders as an em dash — which is worse
 * than absent, because it looks like an answer. B540: a weak model sent
 * `prose` and `slug` and found the real names by being refused twice, so the
 * table has to be worth reading the first time.
 */
describe("the fields of the calls that build a journal", () => {
  const schemasOf = (): [string, Record<string, { description?: string }>][] => {
    const doc = document as unknown as {
      paths: Record<string, Record<string, { requestBody?: { content?: Record<string, { schema?: { $ref?: string; properties?: Record<string, { description?: string }> } }> } }>>;
      components: { schemas: Record<string, { properties?: Record<string, { description?: string }> }> };
    };
    const body = (path: string, verb: string) => {
      const schema = doc.paths[path]?.[verb]?.requestBody?.content?.["application/json"]?.schema;
      const resolved = schema?.$ref ? doc.components.schemas[schema.$ref.split("/").pop() as string] : schema;
      return (resolved?.properties ?? {}) as Record<string, { description?: string }>;
    };
    return [
      ["POST /api/v1/journals", body("/api/v1/journals", "post")],
      ["POST .../trips", body("/api/v1/{user}/trips", "post")],
      ["POST .../days", body("/api/v1/{user}/trips/{trip}/days", "post")],
    ];
  };

  test("each says what it is, so the guide's table is worth reading", () => {
    const silent: string[] = [];
    for (const [where, properties] of schemasOf()) {
      for (const [name, field] of Object.entries(properties)) {
        if (!field.description?.trim()) silent.push(`${where} ${name}`);
      }
    }
    expect(
      silent,
      `these render as an em dash in /agent.md's field table — give each a sentence: ${silent.join(", ")}`,
    ).toEqual([]);
  });
});
