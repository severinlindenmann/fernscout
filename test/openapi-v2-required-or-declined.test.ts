import { describe, expect, test } from "vitest";
import { openApiDocumentV2 } from "@/lib/api/v2/openapi";
import { DAY_DECLINABLES, TRIP_DECLINABLES } from "@/lib/api/v2/schemas";

/**
 * B1648 — the generated day-write schema listed `required: ["slug", "title",
 * "date", "content"]`, but the server refuses `422 incomplete` when, say,
 * `status` is absent and not declined (`DAY_DECLINABLES`,
 * `checkRequiredOrDeclined` in lib/api/v2/schemas/shared.ts). Every
 * declinable field is `.optional()` in the Zod shape — declining it is
 * exactly as valid as answering it — so `z.toJSONSchema()` alone can never
 * say this; the generator (`lib/api/v2/openapi.ts`'s `withRequiredOrDeclined`)
 * has to add it from the same exported list the runtime check reads.
 *
 * These assert the DOCUMENT says what the server does, without hand-typing
 * a second copy of either declinable list here.
 */

type Schema = {
  properties?: Record<string, unknown>;
  allOf?: { anyOf?: unknown[] }[];
  "x-required-or-declined"?: { field: string }[];
};

const document = openApiDocumentV2() as unknown as {
  paths: Record<string, Record<string, { requestBody?: { content?: { "application/json"?: { schema?: Schema } } } }>>;
};

function bodySchema(path: string, verb: string): Schema {
  const schema = document.paths[path]?.[verb]?.requestBody?.content?.["application/json"]?.schema;
  if (!schema) throw new Error(`no request body schema at ${verb.toUpperCase()} ${path}`);
  return schema;
}

describe("the day-write schema names every declinable as required-or-declined", () => {
  const schema = bodySchema("/api/v2/{user}/trips/{trip}/days/{slug}", "put");

  test("x-required-or-declined carries every field DAY_DECLINABLES names, status included", () => {
    const fields = (schema["x-required-or-declined"] ?? []).map((d) => d.field);
    for (const d of DAY_DECLINABLES) expect(fields).toContain(d.field);
    expect(fields).toContain("status");
  });

  test("each declinable gets a field-or-decline constraint, not a bare `required`", () => {
    expect(schema.allOf?.length).toBe(DAY_DECLINABLES.length);
    for (const clause of schema.allOf ?? []) expect(clause.anyOf).toHaveLength(2);
  });

  test("the always-required fields are untouched — still a plain Zod `required`", () => {
    expect(schema.properties).toHaveProperty("slug");
    expect(schema.properties).toHaveProperty("title");
  });
});

describe("the trip-create schema names every declinable as required-or-declined", () => {
  const schema = bodySchema("/api/v2/{user}/trips/{trip}", "put");

  test("x-required-or-declined carries every field TRIP_DECLINABLES names", () => {
    const fields = (schema["x-required-or-declined"] ?? []).map((d) => d.field);
    for (const d of TRIP_DECLINABLES) expect(fields).toContain(d.field);
  });
});
