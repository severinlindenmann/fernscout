import { describe, expect, it } from "vitest";
import { displaySubject } from "@/lib/phone";

describe("displaySubject", () => {
  it("formats a phone subject", () => {
    expect(displaySubject("+41760000000")).toBe("+41 76 000 00 00");
  });
  it("leaves an email untouched", () => {
    expect(displaySubject("reader@example.com")).toBe("reader@example.com");
  });
});
