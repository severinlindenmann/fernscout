import { describe, expect, test } from "vitest";
import { formatGigabytes, formatStagedBytes } from "@/lib/validate/media";

/**
 * B1941 — a run of 18.7 MB printed as "0,0 GB", which is what every import
 * small enough to finish in one sitting looked like on the hub.
 */
describe("what an import weighs, at a unit somebody reads", () => {
  test("a real phone import is megabytes, not a rounded-away zero", () => {
    const bytes = Math.round(18.7 * 1024 ** 2);
    expect(formatStagedBytes(bytes, "en")).toBe("19 MB");
    expect(formatStagedBytes(bytes, "en")).not.toContain("0 GB");
    // The defect itself, kept as the reason this function exists.
    expect(formatGigabytes(bytes, "en")).toBe("0.0 GB");
  });

  test("the decimal mark follows the reader, not the machine", () => {
    const bytes = Math.round(2.5 * 1024 ** 3);
    expect(formatStagedBytes(bytes, "de")).toBe("2,5 GB");
    expect(formatStagedBytes(bytes, "en")).toBe("2.5 GB");
  });

  test("a gigabyte and over keeps the ceiling's own format", () => {
    const bytes = 1024 ** 3;
    expect(formatStagedBytes(bytes, "en")).toBe(formatGigabytes(bytes, "en"));
  });

  test("nothing staged is zero, not a fraction of a gigabyte", () => {
    expect(formatStagedBytes(0, "en")).toBe("0 MB");
  });

  test("under a megabyte is kilobytes, never a rounded-away zero — B2134", () => {
    expect(formatStagedBytes(494 * 1024, "en")).toBe("494 KB");
    expect(formatStagedBytes(10, "en")).toBe("1 KB");
    expect(formatStagedBytes(1024 ** 2 - 1, "en")).toBe("1,023 KB");
    expect(formatStagedBytes(1024 ** 2, "en")).toBe("1 MB");
  });
});
