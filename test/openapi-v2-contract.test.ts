import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openApiDocumentV2 } from "@/lib/api/v2/openapi";
import { ERROR_CODES } from "@/lib/api/errorCodes";

/**
 * Step 6 of the v2 migration: `/api/v2/openapi.json` is GENERATED from the
 * frozen Zod schemas in `lib/api/v2/schemas/` (see `lib/api/v2/openapi.ts`'s
 * own header) rather than hand-written like `lib/api/openapi.ts` (v1). What
 * cannot itself be generated is the ROUTE INVENTORY — which path and verb
 * exist at all — so this file holds that half the same way
 * `test/openapi-contract.test.ts` does for v1: it walks `app/api/v2/` on
 * disk, independently of the generator's own path list, and fails when the
 * two disagree in either direction.
 */

type Operation = {
  responses?: Record<string, unknown>;
};
type PathParameter = {
  name?: string;
  in?: string;
  required?: boolean;
  schema?: unknown;
  description?: string;
};
type Document = {
  paths: Record<string, Record<string, Operation> & { parameters?: PathParameter[] }>;
};

const document = openApiDocumentV2() as unknown as Document;

// B1720 added a path-item-level `parameters` key alongside the verbs — every
// place below that walks "the operations on a path item" has to skip it, or
// it reads as a sixth, bodyless, refusal-less, keyless verb named "parameters".
const VERBS = new Set(["get", "post", "put", "patch", "delete"]);
function operationEntries(methods: Record<string, Operation>): [string, Operation][] {
  return Object.entries(methods).filter(([key]) => VERBS.has(key));
}

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
 * `app/api/v2/[user]/trips/route.ts` → `/api/v2/{user}/trips`. A catch-all
 * segment (`[...path]`) collapses the same way v1's own test handles one —
 * there is none under `app/api/v2` today, but a route added later would
 * still resolve to a parameter rather than a literal, un-matchable path.
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

function routeVerbs(file: string): { path: string; verb: string }[] {
  const path = openApiPath(file);
  const source = readFileSync(file, "utf8");
  const verbs = [...source.matchAll(VERB_RE)].map((m) => m[1].toLowerCase());
  return verbs.map((verb) => ({ path, verb }));
}

/**
 * Cookie-and-browser doors this document deliberately does not describe —
 * B1734, carried over from v1's own `OUT_OF_SCOPE_PREFIXES`
 * (test/openapi-contract.test.ts, now retired with the rest of that file).
 * `/api/auth/identity/**` and `/api/auth/logout` set and clear a cookie;
 * documenting them here would invite an agent to call something it cannot
 * authenticate with and cannot use if it did.
 */
const AUTH_OUT_OF_SCOPE_PREFIXES = ["/api/auth/identity", "/api/auth/logout"];

function inAuthScope(path: string): boolean {
  return !AUTH_OUT_OF_SCOPE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

const files = [
  ...routeFiles("app/api/v2"),
  ...routeFiles("app/api/auth").filter((f) => inAuthScope(openApiPath(f))),
];
const onDisk = files.flatMap(routeVerbs);

describe("the v2 openapi document covers every route on disk", () => {
  test.each(onDisk.map(({ path, verb }) => [path, verb] as const))("%s %s is documented", (path, verb) => {
    const pathItem = document.paths[path];
    expect(pathItem, `${path} is missing from the document entirely`).toBeTruthy();
    expect(Object.keys(pathItem ?? {}), `${path} has no ${verb} in the document`).toContain(verb);
  });

  test("the document names no route the filesystem does not have", () => {
    const onDiskSet = new Set(onDisk.map(({ path, verb }) => `${path} ${verb}`));
    const documented = Object.entries(document.paths).flatMap(([path, methods]) =>
      operationEntries(methods).map(([verb]) => `${path} ${verb}`),
    );
    const stale = documented.filter((entry) => !onDiskSet.has(entry));
    expect(stale, "documented operations with no matching route.ts export").toEqual([]);
  });

  test("every documented operation has at least one refusal (a response 400 or above)", () => {
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const [verb, operation] of operationEntries(methods)) {
        const statuses = Object.keys(operation.responses ?? {}).map(Number);
        const hasRefusal = statuses.some((status) => status >= 400);
        expect(hasRefusal, `${path} ${verb} documents no refusal at all`).toBe(true);
        const hasSuccess = statuses.some((status) => status < 400);
        expect(hasSuccess, `${path} ${verb} documents no success response`).toBe(true);
      }
    }
  });
  /**
   * B1714. The document declares `openapi: 3.1.0`, and for a year it put the
   * request body under `request` — a key the specification does not have. Every
   * generator, validator and client library therefore read two dozen write
   * operations as taking no body at all, and a caller had no reason to suspect
   * a house-private key in a document that names its own version. An agent
   * migrating a real journal reached for `requestBody`, read `undefined`, and
   * wrote every call by hand.
   *
   * So: an operation may carry only what 3.1 defines for one, plus `x-`
   * extensions. Fernscout's own vocabulary already lives correctly as
   * `x-required-or-declined` inside the body schema, which is the shape any
   * future addition has to take too.
   */
  test("every operation carries only keys OpenAPI 3.1 defines, or an x- extension", () => {
    const ALLOWED = new Set([
      "tags",
      "summary",
      "description",
      "externalDocs",
      "operationId",
      "parameters",
      "requestBody",
      "responses",
      "callbacks",
      "deprecated",
      "security",
      "servers",
    ]);
    const strays: string[] = [];
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const [verb, operation] of operationEntries(methods)) {
        for (const key of Object.keys(operation)) {
          if (ALLOWED.has(key) || key.startsWith("x-")) continue;
          strays.push(`${path} ${verb} — ${key}`);
        }
      }
    }
    expect(
      strays,
      "These keys are not in OpenAPI 3.1, so every standard tool ignores them. " +
        'Use the specified key, or prefix an extension with "x-".\n' +
        strays.join("\n"),
    ).toEqual([]);
  });

  /**
   * The other half of B1714: the rename is only worth anything if the key is
   * actually there. These take no body at all — the call itself is the
   * whole instruction — and naming them is what makes an unnamed one a
   * failure rather than a number nobody checks. The two `/api/auth/handover`
   * doors joined the list in B1734: the credential rides in `Authorization:
   * Bearer` or a cookie, and neither route reads a JSON body at all.
   */
  test("every write operation publishes a request body, bar the ones that take none", () => {
    const BODYLESS = new Set([
      "/api/v2/{user}/trips/{trip}/days/{slug}/unpublish post",
      "/api/v2/{user}/trips/{trip}/travellers/from-photo post",
      "/api/v2/{user}/contacts/self post",
      "/api/v2/{user}/contacts/{id}/approve post",
      "/api/v2/{user}/contacts/{id}/revoke post",
      "/api/v2/{user}/contacts/{id}/resend post",
      "/api/auth/handover post",
      "/api/auth/{user}/handover post",
      "/api/v2/{user}/trips/{trip}/track post",
      "/api/v2/{user}/deletions/{token} post",
    ]);
    const missing: string[] = [];
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const [verb, operation] of operationEntries(methods)) {
        if (verb === "get" || verb === "delete") continue;
        if ((operation as { requestBody?: unknown }).requestBody) continue;
        if (BODYLESS.has(`${path} ${verb}`)) continue;
        missing.push(`${path} ${verb}`);
      }
    }
    expect(
      missing,
      "A write whose body vanished from the document — a caller is told to send nothing.\n" +
        missing.join("\n"),
    ).toEqual([]);
  });

  /**
   * B1675. `/docs/api` is the one page a person reads to learn this API, and
   * it rendered `lib/api/openapi.ts` — the **v1** document — through the whole
   * migration and past the end of it, so the human-facing contract described
   * doors that had been deleted. Nothing caught it: every other check asks
   * whether the *document* is right, and this page's fault was which document
   * it asked. So the assertion is about the import, which is the thing that
   * was wrong.
   */
  test("/docs/api renders the v2 document, not v1", () => {
    const page = readFileSync(join(process.cwd(), "app/docs/api/page.tsx"), "utf8");
    expect(page).toContain("openApiDocumentV2");
    expect(page).not.toMatch(/from "@\/lib\/api\/openapi"/);
  });

  /**
   * B1720. Every templated segment (`{user}`, `{trip}`, `{slug}`, `{id}`,
   * `{src}`, `{path}`) was declared in the path string and nowhere else —
   * OpenAPI 3.1 requires a `parameters` entry per hole (`in: "path"`,
   * `required: true`, a `schema`), and there were none, so a generated
   * client had no type, no pattern and no sentence for the values it must
   * substitute; `npx @redocly/cli lint` counted 100 `path-parameters-defined`
   * errors while plain JSON-Schema validation passed, because the
   * requirement lives in the specification's prose rather than its schema.
   * Both directions matter: a hole with no declared parameter leaves a
   * client guessing, and a declared parameter for a hole the path does not
   * have describes a substitution nobody can make.
   */
  test("every path hole has a declared parameter, and no declared parameter names a hole the path lacks", () => {
    const missing: string[] = [];
    const stray: string[] = [];
    const malformed: string[] = [];
    for (const [path, item] of Object.entries(document.paths)) {
      const holes = new Set([...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]));
      const params = item.parameters ?? [];
      const declared = new Set(params.map((p) => p.name));
      for (const hole of holes) {
        if (!declared.has(hole)) missing.push(`${path} — {${hole}} has no declared parameter`);
      }
      for (const param of params) {
        if (!param.name || !holes.has(param.name)) {
          stray.push(`${path} — parameter "${param.name}" names a hole the path does not have`);
          continue;
        }
        if (param.in !== "path") malformed.push(`${path} — {${param.name}} is not declared in: "path"`);
        if (param.required !== true) malformed.push(`${path} — {${param.name}} is not declared required: true`);
        if (!param.schema) malformed.push(`${path} — {${param.name}} has no schema`);
        if (!param.description) malformed.push(`${path} — {${param.name}} has no description`);
      }
    }
    expect(missing, "path holes with no declared parameter:\n" + missing.join("\n")).toEqual([]);
    expect(stray, "declared parameters naming a hole the path does not have:\n" + stray.join("\n")).toEqual([]);
    expect(malformed, "declared parameters missing in/required/schema/description:\n" + malformed.join("\n")).toEqual([]);
  });
});

/**
 * The error vocabulary — carried over from `test/openapi-contract.test.ts`
 * (retired with the rest of v1's hand-written document, B1734) rather than
 * lost with it. Retiring the v1 *document* changed the contract for that
 * file's route-inventory and enum halves; it did not change the contract for
 * this pair, which is about `lib/api/errorCodes.ts` — the one vocabulary
 * every route, v1 or v2, answers refusals from — matching what routes
 * actually send in both directions.
 *
 * An agent that gets `{"error": "unsupported_field"}` and can look the word up
 * knows what to do; one that cannot is left to guess, and a weak model guesses
 * badly. 139 of the 149 places this API once returned a code returned one the
 * document had never mentioned, which is what these tests exist to stop
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
    // v1's own scan was `app/api/v1` + `app/api/auth` + `app/api/v2` —
    // `app/api/v1` is gone with B1734 (this file's own coverage describe
    // above already walks `app/api/v2` and `app/api/auth`, unfiltered here:
    // the OUT_OF_SCOPE identity/logout doors still answer with published
    // codes, they are just not in the path inventory).
    ...routeFiles("app/api/auth"),
    ...routeFiles("app/api/v2"),
    ...SPEAKS_TO_CALLERS,
  ]) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/error:\s*"([a-z_]+)"/g)) answered.add(match[1]);
    for (const match of source.matchAll(/"([a-z_]+)"/g)) spoken.add(match[1]);
  }

  /**
   * The cookie-only doors, for the dead-code direction ONLY — B1613.
   *
   * `/api/helper/**` and the owner's own page routes under `app/[user]/` are
   * browser internals outside the published contract, so they are deliberately
   * NOT held to "every code you answer with must be documented" — that is what
   * `answered` is for, and widening it here would demand an `ERROR_CODES` entry
   * for every refusal in forty files nobody outside ever reads.
   *
   * But they do answer with published codes, and that makes them load-bearing
   * for the OTHER direction. `expected_src` was deleted from `ERROR_CODES`
   * during the v2 migration because the v1 media route that spoke it was
   * removed, and the scan could not see the three cookie-only routes still
   * answering with it — so "documented and never returned" was true of the
   * window and false of the codebase. A published word vanished while live
   * routes still said it.
   *
   * `app/api/web` is on this list for the same reason, B1622: it is the v2
   * migration's own cookie-only prefix (decisions.md §6).
   */
  for (const file of [
    ...routeFiles("app/api/helper"),
    ...routeFiles("app/[user]"),
    ...routeFiles("app/api/web"),
  ]) {
    const source = readFileSync(file, "utf8");
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
});
