import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  A6_LANDSCAPE,
  mediaBox,
  mm,
  requiredPixelHeight,
  requiredPixelWidth,
} from "@/lib/postcard/spec";
import { readJpeg } from "@/lib/postcard/pdf";
import { renderPostcard, type PostalAddress } from "@/lib/postcard/render";

const PHOTO = path.join(
  process.cwd(),
  "content",
  "example",
  "trips",
  "asia-2023",
  "media",
  "hue-to-hoi-an",
  "01.jpg",
);

function photo(): Uint8Array {
  return new Uint8Array(fs.readFileSync(PHOTO));
}

const TO: PostalAddress = {
  name: "Frau Maria Muster",
  line1: "Bahnhofstrasse 12",
  postcode: "8001",
  city: "Zurich",
  country: "Schweiz",
};

function render(over: Partial<Parameters<typeof renderPostcard>[0]> = {}) {
  return renderPostcard({
    photo: photo(),
    message: "Hello from the road.",
    from: "Us",
    to: TO,
    ...over,
  });
}

describe("print geometry", () => {
  test("A6 landscape media box is trim plus bleed on every edge", () => {
    const box = mediaBox(A6_LANDSCAPE);
    // 148 + 3 + 3 = 154mm, 105 + 3 + 3 = 111mm
    expect(box.width).toBeCloseTo(mm(154), 3);
    expect(box.height).toBeCloseTo(mm(111), 3);
  });

  test("a millimetre is 72/25.4 points", () => {
    expect(mm(25.4)).toBeCloseTo(72, 6);
  });

  test("300 DPI over the bleed size needs 1819 x 1312 pixels", () => {
    expect(requiredPixelWidth(A6_LANDSCAPE)).toBe(1819);
    expect(requiredPixelHeight(A6_LANDSCAPE)).toBe(1312);
  });
});

describe("JPEG parsing", () => {
  test("reads dimensions and colour model from the frame header", () => {
    const image = readJpeg(photo());
    expect(image.width).toBeGreaterThan(0);
    expect(image.height).toBeGreaterThan(0);
    expect([1, 3, 4]).toContain(image.components);
  });

  test("rejects a non-JPEG rather than producing a broken card", () => {
    expect(() => readJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow(/JPEG/);
  });

  test("rejects a truncated JPEG", () => {
    expect(() => readJpeg(new Uint8Array([0xff, 0xd8, 0xff]))).toThrow(/JPEG/);
  });
});

describe("rendering", () => {
  test("produces a structurally valid PDF", () => {
    const { pdf } = render();
    const text = Buffer.from(pdf).toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("startxref");
    expect(text).toContain("/Type /Catalog");
  });

  /** The difference between a PDF that is correct and one that is printable. */
  test("declares TrimBox and BleedBox so the printer knows where to cut", () => {
    const text = Buffer.from(render().pdf).toString("latin1");
    expect(text).toContain("/TrimBox");
    expect(text).toContain("/BleedBox");
  });

  test("embeds the photograph without re-encoding it", () => {
    const original = photo();
    const { pdf } = render();
    expect(Buffer.from(pdf).includes(Buffer.from(original))).toBe(true);
    expect(Buffer.from(pdf).toString("latin1")).toContain("/DCTDecode");
  });

  test("two pages by default, one when a single side is asked for", () => {
    expect(Buffer.from(render().pdf).toString("latin1")).toContain("/Count 2");
    expect(Buffer.from(render({ sides: "front" }).pdf).toString("latin1")).toContain("/Count 1");
    expect(Buffer.from(render({ sides: "back" }).pdf).toString("latin1")).toContain("/Count 1");
  });

  test("the front carries the photo and the back does not", () => {
    expect(Buffer.from(render({ sides: "front" }).pdf).toString("latin1")).toContain("/DCTDecode");
    expect(Buffer.from(render({ sides: "back" }).pdf).toString("latin1")).not.toContain(
      "/DCTDecode",
    );
  });

  test("the address appears on the back", () => {
    const text = Buffer.from(render({ sides: "back" }).pdf).toString("latin1");
    for (const line of ["Frau Maria Muster", "Bahnhofstrasse 12", "8001 Zurich", "Schweiz"]) {
      expect(text).toContain(line);
    }
  });

  test("an optional address line is omitted rather than left blank", () => {
    const text = Buffer.from(render({ sides: "back" }).pdf).toString("latin1");
    expect(text).not.toContain("()");
  });

  /** A photo too small for print must say so — this is invisible on screen and
   * obvious on paper. */
  test("warns when the photo cannot hit the target DPI", () => {
    const result = render();
    const warning = result.warnings.find((w) => w.code === "low-resolution");
    expect(warning).toBeDefined();
    expect(warning?.detail).toContain("1819px");
    expect(result.photo.effectiveDpi).toBeLessThan(A6_LANDSCAPE.dpi);
  });

  test("warns when the message will not fit rather than silently cutting it", () => {
    const long = "Ein sehr langer Satz ueber den Tag. ".repeat(40);
    const result = render({ message: long });
    expect(result.warnings.some((w) => w.code === "message-truncated")).toBe(true);
  });

  test("a short message produces no warnings about length", () => {
    expect(render().warnings.some((w) => w.code === "message-truncated")).toBe(false);
  });

  test("parentheses in a message cannot break the PDF syntax", () => {
    const text = Buffer.from(
      render({ message: "A (parenthesised) note with a \\ backslash", sides: "back" }).pdf,
    ).toString("latin1");
    expect(text).toContain("\\(parenthesised\\)");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  test("guides are off unless asked for", () => {
    const withGuides = Buffer.from(render({ guides: true }).pdf).toString("latin1");
    const without = Buffer.from(render().pdf).toString("latin1");
    expect(withGuides.length).toBeGreaterThan(without.length);
  });
});
