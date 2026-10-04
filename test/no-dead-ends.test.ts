import { describe, expect, test } from "vitest";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(p, "utf8");

describe("no dead ends (B2851)", () => {
  test("the crash pages link out beside Retry", () => {
    expect(read("app/error.tsx")).toContain('href="/"');
    expect(read("app/global-error.tsx")).toContain('href="/"');
  });
  test("the slim header keeps Home at phone width", () => {
    expect(read("components/landing/Frame.tsx")).not.toContain("hidden px-2 sm:inline");
  });
  test("a spent token page is replaced, not left in history", () => {
    expect(read("components/SignInButton.tsx")).not.toMatch(/location\.href\s*=/);
  });
  test("/j and /w dead links carry a way out", () => {
    for (const p of ["app/j/[code]/page.tsx", "app/w/[code]/page.tsx"]) {
      expect(read(p)).toContain('"err.goToStart"');
    }
  });
});
