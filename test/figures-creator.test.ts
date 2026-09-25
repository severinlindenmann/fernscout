import { describe, expect, test } from "vitest";
import { applyPreset, deriveFigureId, filterPhotoProposal, presetTileLabel } from "@/lib/figures/creator";

describe("applyPreset", () => {
  test("overwrites only what the preset names, keeping the rest", () => {
    const current = { id: "anna", name: "Anna", person: "anna@example.com", outfit: "dress" as const };
    const next = applyPreset(current, "european");
    expect(next).toMatchObject({
      id: "anna",
      name: "Anna",
      person: "anna@example.com",
      outfit: "dress",
      skin: "light",
      hair: "blond",
      hairStyle: "short",
      eyes: "blue",
      shirt: "blue",
    });
  });

  test("an unknown preset name leaves the figure untouched", () => {
    const current = { id: "anna", skin: "deep" as const };
    expect(applyPreset(current, "not-a-real-preset")).toEqual(current);
  });
});

describe("filterPhotoProposal", () => {
  test("drops build, age, pants and outfit even when the photo answered them", () => {
    const result = filterPhotoProposal({
      figure: {
        skin: "medium",
        hair: "black",
        hairStyle: "coils",
        eyes: "brown",
        shirt: "coral",
        pants: "slate",
        outfit: "trousers",
        build: "broad",
        age: "elder",
        accessories: ["glasses", "camera"],
      },
      unanswerable: [],
    });
    expect(result.figure).toEqual({
      skin: "medium",
      hair: "black",
      hairStyle: "coils",
      eyes: "brown",
      shirt: "coral",
      accessories: ["glasses"],
    });
  });

  test("an accessory list with nothing proposable is left out entirely", () => {
    const result = filterPhotoProposal({
      figure: { skin: "medium", accessories: ["camera", "stick"] },
      unanswerable: [],
    });
    expect(result.figure.accessories).toBeUndefined();
  });

  test("unanswerable only reports fields this path ever proposes", () => {
    const result = filterPhotoProposal({
      figure: {},
      unanswerable: ["skin", "hair", "hairStyle", "eyes", "shirt", "pants", "outfit", "build", "age", "accessories"],
    });
    expect(result.unanswerable.sort()).toEqual(
      ["accessories", "eyes", "hair", "hairStyle", "shirt", "skin"].sort(),
    );
  });

  // The safeguard FigureCreator's own applyCandidate also runs this
  // through: a proposal carrying build and age (the helper should never
  // answer them, but nothing stops a future model response from doing so)
  // must lose both before it ever reaches the figure being shaped.
  test("a proposal carrying build and age loses both", () => {
    const result = filterPhotoProposal({
      figure: { skin: "medium", build: "broad", age: "elder" },
      unanswerable: [],
    });
    expect(result.figure).not.toHaveProperty("build");
    expect(result.figure).not.toHaveProperty("age");
    expect(result.figure).toEqual({ skin: "medium" });
  });
});

describe("presetTileLabel", () => {
  test("names the hair style and the shirt colour, and skips black hair", () => {
    expect(
      presetTileLabel({ hairStyle: "long", hair: "black", shirt: "coral" }),
    ).toBe("long hair, coral");
  });

  test("names the hair colour too when it is not black", () => {
    expect(
      presetTileLabel({ hairStyle: "curly", hair: "dark-brown", shirt: "rust" }),
    ).toBe("curly hair, dark brown, rust");
    expect(
      presetTileLabel({ hairStyle: "short", hair: "blond", shirt: "blue" }),
    ).toBe("short hair, blond, blue");
  });
});

describe("deriveFigureId", () => {
  test("lowercases, strips accents and joins words with hyphens", () => {
    expect(deriveFigureId("Tomi Nagy")).toBe("tomi-nagy");
    expect(deriveFigureId("Ánna Kéller")).toBe("anna-keller");
  });

  test("falls back to a plain word when nothing survives", () => {
    expect(deriveFigureId("!!!")).toBe("figure");
  });

  test("adds a numeric suffix when the id is already taken", () => {
    expect(deriveFigureId("Anna", ["anna"])).toBe("anna-2");
    expect(deriveFigureId("Anna", ["anna", "anna-2"])).toBe("anna-3");
  });
});
