import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openApiDocument } from "@/lib/api/openapi";

/**
 * Which write routes have published what they accept.
 *
 * B535 makes the OpenAPI document executable: a route hands its `requestBody`
 * schema to `checkBody`, and a field the schema does not name is refused
 * instead of silently dropped. A route with no schema cannot do that, so this
 * is the list of routes that cannot yet — and it is B536's work list.
 *
 * It asserts the list **exactly**, rather than asserting it is empty, so it
 * passes today and still fails the moment a new route arrives without a
 * schema. Deleting entries is the work; adding one is a regression.
 *
 * File-level on purpose: it asks whether a route that reads a body documents
 * *a* body, not which of its verbs does. Per-verb attribution needs the
 * handler's own control flow, which is a parser this does not need to be.
 */

/**
 * The routes `checkBody` cannot check yet. Seven of them, and all seven are
 * absent from the document altogether rather than merely lacking a body —
 * `openapi.ts` still opens by saying "there are five endpoints". Two are
 * doors `AGENTS.md` sends agents to by name: `.../people` and
 * `.../travellers` are described in prose and appear nowhere in the machine
 * contract. B536.
 */
const WITHOUT_A_SCHEMA = [
  "/api/v1/{user}/channels",
  "/api/v1/{user}/credits/purchase",
  "/api/v1/{user}/keys",
  "/api/v1/{user}/payments/{id}/approve",
  "/api/v1/{user}/payments/{id}/pay",
  "/api/v1/{user}/trips/{trip}/people",
  "/api/v1/{user}/trips/{trip}/travellers",
];
function routeFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) routeFiles(path, found);
    else if (entry === "route.ts") found.push(path);
  }
  return found;
}

/** `app/api/v1/[user]/trips/route.ts` → `/api/v1/{user}/trips`. */
function openApiPath(file: string): string {
  return "/" + file.slice("app/".length, -"/route.ts".length).replace(/\[(\w+)\]/g, "{$1}");
}

describe("every /api/v1 route that reads a body", () => {
  const document = openApiDocument() as unknown as {
    paths: Record<string, Record<string, { requestBody?: unknown }>>;
  };

  const readsABody = routeFiles("app/api/v1")
    .filter((file) => /request\.json\(\)|req\.json\(\)/.test(readFileSync(file, "utf8")))
    .map(openApiPath)
    .sort();

  const documented = readsABody.filter((path) =>
    Object.values(document.paths[path] ?? {}).some((verb) => verb?.requestBody),
  );

  test("is a route this test can see", () => {
    // If this drops to nothing the walk broke, and every assertion below
    // would pass by describing an empty world.
    expect(readsABody.length).toBeGreaterThan(10);
  });

  test("either publishes a request schema, or is on B536's list", () => {
    const undocumented = readsABody.filter((path) => !documented.includes(path));
    expect(undocumented).toEqual(WITHOUT_A_SCHEMA);
  });

  test("the ones that are documented are documented as a path, not only in prose", () => {
    expect(documented.filter((path) => !document.paths[path])).toEqual([]);
  });
});
