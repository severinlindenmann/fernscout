import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { translateIn } from "@/lib/locales";

describe("B2813 WebOTP origin line", () => {
  for (const l of ["en", "de", "hu", "fr", "it"]) {
    test(`${l}: the body ends with "@host #code"`, () => {
      const body = translateIn(l, "code.phoneVerify", { code: "123456", site: "Fernscout", host: "example.org" });
      expect(body.split("\n").at(-1)).toBe("@example.org #123456");
    });
  }
  test("sms.ts derives the host from the site url", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "lib", "phoneVerify", "sms.ts"), "utf8");
    expect(src).toContain("new URL(url).host");
  });
});
