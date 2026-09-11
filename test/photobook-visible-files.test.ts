import { describe, expect, test } from "vitest";
import { visibleBookFiles } from "@/lib/photobook/visibleFiles";

describe("visibleBookFiles — B1366", () => {
  test("drops the single-volume print halves, keeps the whole book", () => {
    expect(visibleBookFiles(["book-interior.pdf", "book-cover.pdf", "book.pdf"])).toEqual([
      "book.pdf",
    ]);
  });

  test("drops the multi-volume halves too, keeping one whole file per volume", () => {
    // The trap: a filter matching the literal "book-interior.pdf" passes a
    // single-volume check and still ships v1-interior.pdf/v1-cover.pdf for
    // every multi-volume book — build.ts names the halves v{index}-interior
    // and v{index}-cover once there is more than one volume.
    expect(
      visibleBookFiles([
        "v1-interior.pdf",
        "v1-cover.pdf",
        "v1.pdf",
        "v2-interior.pdf",
        "v2-cover.pdf",
        "v2.pdf",
      ]),
    ).toEqual(["v1.pdf", "v2.pdf"]);
  });

  test("an order with only the two halves — before the whole file existed — filters to empty", () => {
    expect(visibleBookFiles(["book-interior.pdf", "book-cover.pdf"])).toEqual([]);
  });
});
