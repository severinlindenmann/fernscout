import { describe, expect, test } from "vitest";
import { clampSignals, describedFormSchema, parseDescribed } from "@/lib/photos/described";

const LOCALES = ["en"] as const;

function form(over: Record<string, unknown> = {}) {
  return {
    caption: { en: "Two people on a boat" },
    altText: { en: "Two people sit in a small boat on a lake." },
    longDescription: { en: null },
    tags: ["group"],
    confidence: "high",
    subject: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 },
    people: 2,
    printworthiness: 4,
    ...over,
  };
}

const stored = { at: "2026-09-22T00:00:00.000Z", model: "test", schemaVersion: 1, contentHash: "abc" };

describe("the three signals in the model's own schema", () => {
  test("the output schema requires subject, people and printworthiness", () => {
    const shape = describedFormSchema(LOCALES).shape;
    expect(Object.keys(shape)).toEqual(
      expect.arrayContaining(["subject", "people", "printworthiness"]),
    );
    expect(describedFormSchema(LOCALES).safeParse(form()).success).toBe(true);
    expect(describedFormSchema(LOCALES).safeParse(form({ people: undefined })).success).toBe(false);
  });

  test("subject may be null when there is no single subject", () => {
    expect(describedFormSchema(LOCALES).safeParse(form({ subject: null })).success).toBe(true);
  });
});

describe("a stored block from before the signals existed", () => {
  test("still parses, with the signals absent", () => {
    const { subject, people, printworthiness, ...old } = form();
    const block = parseDescribed({ ...old, ...stored }, LOCALES);
    expect(block).not.toBeNull();
    expect(block!.subject).toBeUndefined();
    expect(block!.people).toBeUndefined();
    expect(block!.printworthiness).toBeUndefined();
  });
});

describe("clamping what the model said", () => {
  test("a rectangle is kept inside the frame and a score inside 1–5", () => {
    const out = clampSignals(form({ subject: { x: -0.2, y: 0.9, width: 0.8, height: 0.5 }, people: -1, printworthiness: 9 }));
    expect(out.subject).toEqual({ x: 0, y: 0.9, width: 0.8, height: 0.1 });
    expect(out.people).toBe(0);
    expect(out.printworthiness).toBe(5);
  });

  test("a rectangle with no area becomes null", () => {
    const out = clampSignals(form({ subject: { x: 0.5, y: 0.5, width: 0, height: 0.2 } }));
    expect(out.subject).toBeNull();
  });

  test("a fractional people count is rounded down", () => {
    expect(clampSignals(form({ people: 2.7 })).people).toBe(2);
  });
});
