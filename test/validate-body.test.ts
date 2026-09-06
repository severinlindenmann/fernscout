import { describe, expect, test } from "vitest";
import { checkBody, suggestField, type Schema } from "@/lib/validate/body";
import { openApiDocument } from "@/lib/api/openapi";

/**
 * What happens to a field the API does not recognise.
 *
 * Until B535 the answer was: nothing. It was dropped, the write succeeded, and
 * the caller was told so. These assert the refusal *and* its wording — the
 * reader is a program trying to fix its own payload, and "unknown field
 * `visibilty`" without the suggestion sends it back to the documentation.
 */

const trip: Schema = {
  type: "object",
  required: ["id", "title"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    visibility: { type: "string", enum: ["public", "guest", "private"] },
    listed: { type: "boolean" },
    lat: { type: "number" },
    lng: { type: "number" },
    transportMode: { type: "string" },
  },
};

const good = { id: "alps-2024", title: "Alps 2024" };

describe("a body that fits its schema", () => {
  test("passes with nothing said", () => {
    expect(checkBody(good, trip)).toEqual({ problems: [], warnings: [] });
  });

  test("optional fields are optional", () => {
    expect(checkBody({ ...good, visibility: "guest" }, trip).problems).toEqual([]);
  });
});

describe("a field the schema does not have", () => {
  test("is refused rather than dropped", () => {
    const { problems } = checkBody({ ...good, visibilty: "guest" }, trip);
    expect(problems).toHaveLength(1);
    expect(problems[0].field).toBe("visibilty");
    expect(problems[0].got).toBe('"guest"');
  });

  test("names the field the caller meant", () => {
    const { problems } = checkBody({ ...good, visibilty: "guest" }, trip);
    expect(problems[0].hint).toContain('did you mean "visibility"');
  });

  test("catches another API's separator habits", () => {
    const { problems } = checkBody({ ...good, transport_mode: "car" }, trip);
    expect(problems[0].hint).toContain('did you mean "transportMode"');
  });

  test("says so plainly when nothing is close", () => {
    const { problems } = checkBody({ ...good, weather: "rain" }, trip);
    expect(problems[0].hint).toContain("was not written");
    expect(problems[0].hint).not.toContain("did you mean");
    expect(problems[0].expected).toContain("visibility");
  });

  test("does not pair two short fields that merely look alike", () => {
    expect(suggestField("lng", ["lat", "lng"])).toBeNull();
    expect(suggestField("lat", ["lat", "lng"])).toBeNull();
  });

  test("is a warning, not a refusal, where the schema takes free-form keys", () => {
    const open = { ...trip, additionalProperties: true };
    const { problems, warnings } = checkBody({ ...good, whatever: 1 }, open);
    expect(problems).toEqual([]);
    expect(warnings).toHaveLength(1);
  });
});

describe("the schema's own rules", () => {
  test("a missing required field is named", () => {
    const { problems } = checkBody({ id: "alps-2024" }, trip);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ field: "title", got: "nothing", expected: "a string" });
  });

  test("a number sent as a string is refused", () => {
    const { problems } = checkBody({ ...good, lat: "46.5" }, trip);
    expect(problems).toEqual([{ field: "lat", got: '"46.5"', expected: "a number" }]);
  });

  test("a value outside the enum is refused, and the enum is printed", () => {
    const { problems } = checkBody({ ...good, visibility: "secret" }, trip);
    expect(problems[0].expected).toBe('one of "public", "guest", "private"');
  });

  test("every problem at once, not the first", () => {
    const { problems } = checkBody({ lat: "46.5", visibilty: "guest" }, trip);
    expect(problems.map((p) => p.field).sort()).toEqual(["id", "lat", "title", "visibilty"]);
  });

  test("a body that is not an object is refused before anything else", () => {
    expect(checkBody([1, 2], trip).problems).toEqual([
      { field: "(body)", got: "[1,2]", expected: "a JSON object" },
    ]);
    expect(checkBody(null, trip).problems).toHaveLength(1);
  });
});

describe("a route whose schema has not been written", () => {
  test("warns and refuses nothing — a documentation gap must not stop a write", () => {
    const { problems, warnings } = checkBody({ anything: true }, null);
    expect(problems).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].hint).toContain("B536");
  });
});

describe("$ref, against the document's own components", () => {
  test("resolves before checking", () => {
    const schemas = { Trip: trip };
    const { problems } = checkBody({ ...good, visibilty: "guest" }, { $ref: "#/components/schemas/Trip" }, schemas);
    expect(problems[0].field).toBe("visibilty");
  });

  test("an unresolvable ref checks nothing rather than refusing everything", () => {
    const { problems } = checkBody({ ...good }, { $ref: "#/components/schemas/Missing" }, {});
    expect(problems).toEqual([]);
  });
});

/**
 * The published contract, run against itself. This is the whole point of
 * B535: the schema is not a copy written for this checker, it is the document
 * `/openapi.json` already serves.
 */
describe("the real Draft schema from lib/api/openapi.ts", () => {
  const document = openApiDocument() as unknown as {
    components: { schemas: Record<string, Schema> };
  };
  const schemas = document.components.schemas;
  const draft = schemas.Draft;
  const day = { title: "Grimsel, in the rain", date: "2024-09-13", content: "Rain the whole way up." };

  test("a good day passes", () => {
    expect(checkBody(day, draft, schemas)).toEqual({ problems: [], warnings: [] });
  });

  test("transport_mode is refused, and transportMode suggested", () => {
    const { problems } = checkBody({ ...day, transport_mode: "car" }, draft, schemas);
    expect(problems).toHaveLength(1);
    expect(problems[0].hint).toContain('did you mean "transportMode"');
  });

  test("costs sent as an object rather than a list is refused", () => {
    const { problems } = checkBody({ ...day, costs: { label: "Dinner" } }, draft, schemas);
    expect(problems).toEqual([{ field: "costs", got: '{"label":"Dinner"}', expected: "an array" }]);
  });

  test("a day with no content is told which field is missing", () => {
    const { problems } = checkBody({ title: "x", date: "2024-09-13" }, draft, schemas);
    expect(problems.map((p) => p.field)).toEqual(["content"]);
  });

  test("status is not a field of this endpoint — publishing is a second call", () => {
    const { problems } = checkBody({ ...day, status: "published" }, draft, schemas);
    expect(problems).toHaveLength(1);
    expect(problems[0].field).toBe("status");
  });
});
