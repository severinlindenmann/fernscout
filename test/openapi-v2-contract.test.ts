import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openApiDocumentV2 } from "@/lib/api/v2/openapi";

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
type Document = {
  paths: Record<string, Record<string, Operation>>;
};

const document = openApiDocumentV2() as unknown as Document;

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

const files = routeFiles("app/api/v2");
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
      Object.keys(methods).map((verb) => `${path} ${verb}`),
    );
    const stale = documented.filter((entry) => !onDiskSet.has(entry));
    expect(stale, "documented operations with no matching route.ts export").toEqual([]);
  });

  test("every documented operation has at least one refusal (a response 400 or above)", () => {
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const [verb, operation] of Object.entries(methods)) {
        const statuses = Object.keys(operation.responses ?? {}).map(Number);
        const hasRefusal = statuses.some((status) => status >= 400);
        expect(hasRefusal, `${path} ${verb} documents no refusal at all`).toBe(true);
        const hasSuccess = statuses.some((status) => status < 400);
        expect(hasSuccess, `${path} ${verb} documents no success response`).toBe(true);
      }
    }
  });
});
