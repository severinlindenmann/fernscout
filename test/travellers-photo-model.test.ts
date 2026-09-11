import { describe, expect, test, vi } from "vitest";

/**
 * `classifyTravellers` itself — the guard inside it, not the route around it.
 *
 * `test/travellers-from-photo.test.ts` mocks this function entirely to
 * exercise the route (auth, consent, credits, "already this journal's own").
 * This file does the opposite: the model is scripted at the SDK boundary, and
 * what is checked is the one thing AGENTS.md asks for on every tool that lets
 * a model assert something new — that the claim is checked against the
 * vocabulary it was given, never trusted on the model's own say-so.
 */

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

function scripted(figures: unknown[]) {
  create.mockResolvedValueOnce({
    content: [{ type: "text", text: JSON.stringify({ figures }) }],
    usage: { input_tokens: 10, output_tokens: 10 },
  });
}

const image = { base64: "AA==", mediaType: "image/webp" as const };

test("a fully answered figure carries no unanswerable fields", async () => {
  const { classifyTravellers } = await import("@/lib/helper/model");
  scripted([
    {
      skin: "medium",
      hair: "black",
      hairStyle: "coils",
      eyes: "brown",
      shirt: "coral",
      pants: "slate",
      outfit: "trousers",
      build: "average",
      age: "adult",
      accessories: ["glasses"],
    },
  ]);
  const result = await classifyTravellers(image);
  expect(result).toHaveLength(1);
  expect(result[0].unanswerable).toEqual([]);
  expect(result[0].figure).toEqual({
    skin: "medium",
    hair: "black",
    hairStyle: "coils",
    eyes: "brown",
    shirt: "coral",
    pants: "slate",
    outfit: "trousers",
    build: "average",
    age: "adult",
    accessories: ["glasses"],
  });
});

test("an empty string reads as unanswered, not as a default", async () => {
  const { classifyTravellers } = await import("@/lib/helper/model");
  scripted([
    { skin: "deep", hair: "", hairStyle: "", eyes: "", shirt: "", pants: "", outfit: "", build: "", age: "", accessories: [] },
  ]);
  const result = await classifyTravellers(image);
  expect(result[0].figure).toEqual({ skin: "deep" });
  expect(result[0].unanswerable).toEqual(
    expect.arrayContaining(["hair", "hairStyle", "eyes", "shirt", "pants", "outfit", "build", "age", "accessories"]),
  );
});

// AGENTS.md: a claim is checked against the turn, never taken on the model's
// own phrasing. The schema's own `enum` is the first line of defence; this is
// the second, for whatever reaches this function despite it.
test("a value outside the published vocabulary is treated as unanswered rather than written", async () => {
  const { classifyTravellers } = await import("@/lib/helper/model");
  scripted([{ skin: "chartreuse", hair: "black", accessories: ["a-drone"] }]);
  const result = await classifyTravellers(image);
  expect(result[0].figure.skin).toBeUndefined();
  expect(result[0].figure.hair).toBe("black");
  expect(result[0].figure.accessories).toBeUndefined();
  expect(result[0].unanswerable).toEqual(expect.arrayContaining(["skin", "accessories"]));
});

// The classifier has no field for it and no vocabulary for a name at all —
// even a model that tried to smuggle one in has nowhere for it to land.
test("nothing here can produce a `for`", async () => {
  const { classifyTravellers } = await import("@/lib/helper/model");
  scripted([{ skin: "medium", for: "someone@example.test" }]);
  const result = await classifyTravellers(image);
  expect(result[0].figure).not.toHaveProperty("for");
});

test("more figures than the vocabulary allows are truncated, not refused", async () => {
  const { classifyTravellers } = await import("@/lib/helper/model");
  const { MAX_FIGURES } = await import("@/lib/travellers/vocabulary");
  scripted(Array.from({ length: MAX_FIGURES + 5 }, () => ({ skin: "medium" })));
  const result = await classifyTravellers(image);
  expect(result).toHaveLength(MAX_FIGURES);
});

describe("the system prompt", () => {
  test("treats a child exactly like every other figure, and never more precisely", async () => {
    // Read the prompt indirectly through a real call, since the function
    // that builds it is not exported — the same discipline PHOTO_SYSTEM_PROMPT
    // uses for describePhotos, exported instead. Asserting on `create`'s own
    // call captures the same string either way.
    const { classifyTravellers } = await import("@/lib/helper/model");
    scripted([{ skin: "medium" }]);
    await classifyTravellers(image);
    const [args] = create.mock.calls.at(-1) as [{ system: string }];
    expect(args.system).toMatch(/the way you would an adult/i);
    expect(args.system).toMatch(/never identify anyone/i);
    expect(args.system).toMatch(/no estimated age in years/i);
  });
});
