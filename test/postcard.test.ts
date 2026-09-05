import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  A6_LANDSCAPE,
  MESSAGE_PT,
  fontFraction,
  mediaBox,
  mm,
  requiredPixelHeight,
  requiredPixelWidth,
} from "@/lib/postcard/spec";
import { backLayout } from "@/lib/postcard/preview";
import { readJpeg } from "@/lib/postcard/pdf";
import { renderPostcard, type PostalAddress } from "@/lib/postcard/render";
import { recipientBase, recipientBases, slug } from "@/lib/postcard/filename";

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

/**
 * B86 — the files a run leaves behind must be one per recipient.
 *
 * These names are invented. `test/depersonalised.test.ts` fails the build on a
 * real name appearing outside `content/`, and a recipient list is exactly the
 * shape that rule exists for.
 */
describe("naming a recipient's files", () => {
  test("a Latin name keeps the name it has today", () => {
    expect(recipientBase("Ana Bergström", 0)).toBe("ana-bergstrom");
    expect(recipientBase("Jean-Luc O'Hara", 3)).toBe("jean-luc-o-hara");
  });

  test("a name in a non-Latin script gets a name instead of nothing", () => {
    // Empty base names produced `.pdf` and `-front.pdf`: dotfiles, invisible
    // to a plain `ls` in the folder the author sends to a printer.
    for (const name of ["Δημήτρης", "Владимир", "山田 太郎", "אברהם", "김민준"]) {
      const base = recipientBase(name, 0);
      expect(base).not.toBe("");
      expect(base.startsWith(".")).toBe(false);
    }
  });

  test("two such names in one batch do not collide", () => {
    // The defect, and the reason the fallback is the batch position rather
    // than a shared constant: a constant fixes the dotfile and still loses
    // one of the two cards.
    const batch = ["Δημήτρης Παπαδόπουλος", "Владимир Ильин", "山田 太郎"];
    const names = batch.map((name, index) => recipientBase(name, index));
    expect(new Set(names).size).toBe(batch.length);
  });

  test("a mixed batch numbers by position, so a name never moves another's file", () => {
    const batch = ["Ana Bergström", "山田 太郎", "Bo Lind", "Владимир Ильин"];
    expect(batch.map((name, index) => recipientBase(name, index))).toEqual([
      "ana-bergstrom",
      "recipient-2",
      "bo-lind",
      "recipient-4",
    ]);
  });

  /**
   * B202 — `ß` has no decomposition, so NFD cannot reach it and the character
   * class after it turned the letter into a hyphen: `stra-er`, one letter
   * short of the name on the envelope. Spelled out before the accents come
   * off, which is the line B151 put in `lib/mail/index.ts`.
   */
  test("a German ß keeps its word instead of becoming a hyphen", () => {
    expect(slug("Straße")).toBe("strasse");
    expect(recipientBase("Anna Straßer", 0)).toBe("anna-strasser");
    // Capital ẞ arrives at the expansion already lowercased.
    expect(recipientBase("ANNA STRAßER", 0)).toBe("anna-strasser");
  });

  test("the umlaut rule stays where it is, and differs from lib/slug.ts on purpose", () => {
    // `ü` is `u` here and `ue` in a permalink. The transliteration table earns
    // its keep in a permanent shared address and this is a gitignored
    // filename — B77, restated by B86 and B151. A later unification has to
    // argue with this line.
    expect(slug("Grüße vom Weg")).toBe("grusse-vom-weg");
    expect(slug("Grüße vom Weg")).not.toContain("gruesse");
  });
});

/**
 * B150 — two recipients who are called the same thing.
 *
 * B86 answered for a name that slugs to nothing. This is a name that slugs to
 * the same *something* as somebody else's: a mother and a daughter both called
 * Anna Meier wrote both cards to `anna-meier.pdf`, second over first, and the
 * run printed two lines for one file.
 */
describe("two recipients with the same name", () => {
  test("each gets a file of its own, and the run is told which moved", () => {
    const files = recipientBases(["Anna Meier", "Bo Lind", "Anna Meier"]);
    expect(files.map((f) => f.base)).toEqual(["anna-meier", "bo-lind", "anna-meier-2"]);
    expect(files.map((f) => f.renamed)).toEqual([false, false, true]);
    // What the run prints, so the author knows whose card is whose.
    expect(files[2].wanted).toBe("anna-meier");
  });

  test("a batch with no repeated name keeps the filenames it has today", () => {
    const batch = ["Ana Bergström", "山田 太郎", "Bo Lind", "Jean-Luc O'Hara"];
    expect(recipientBases(batch).map((f) => f.base)).toEqual(
      batch.map((name, index) => recipientBase(name, index)),
    );
    expect(recipientBases(batch).every((f) => !f.renamed)).toBe(true);
  });

  test("the suffix counts past a name already in the list", () => {
    // Written by hand as "Anna Meier 2", so the obvious suffix is taken.
    const files = recipientBases(["Anna Meier", "Anna Meier", "Anna Meier 2"]);
    expect(new Set(files.map((f) => f.base)).size).toBe(3);
    expect(files.map((f) => f.base)).toEqual([
      "anna-meier",
      "anna-meier-2",
      "anna-meier-2-2",
    ]);
  });

  test("the same list twice produces the same names, so a re-run renumbers nobody", () => {
    const batch = ["Anna Meier", "Δημήτρης", "Anna Meier", "Anna Straßer"];
    expect(recipientBases(batch)).toEqual(recipientBases(batch));
    expect(recipientBases(batch).map((f) => f.base)).toEqual([
      "anna-meier",
      "recipient-2",
      "anna-meier-2",
      "anna-strasser",
    ]);
  });

  test("two names that slug to nothing still do not collide", () => {
    // The B86 fallback is the batch position, so it is unique before this
    // function sees it — but the rule has to hold through it.
    const files = recipientBases(["Δημήτρης", "Владимир", "山田 太郎"]);
    expect(new Set(files.map((f) => f.base)).size).toBe(3);
  });
});


/**
 * B451 — the on-screen card is sized from the printer's own numbers.
 *
 * The preview showed the message at roughly twice its real size because the
 * page carried a hand-typed `2.4cqw` and applied it against the wrong
 * container. The number is now derived, and this is what keeps it that way:
 * change `MESSAGE_PT` and the preview has to move with it, because there is
 * nowhere else for the percentage to come from.
 */
describe("the preview is drawn to the printer's measurements", () => {
  test("the message percentage is the point size over the card width", () => {
    const expected = `${(fontFraction(MESSAGE_PT) * 100).toFixed(3)}cqw`;
    expect(backLayout().font.message).toBe(expected);
  });

  test("and that is about 2.3% of the card, not 2.4", () => {
    // 10pt on a 154mm (436.5pt) bleed box. Spelled out because the old value
    // was close enough to look right and wrong enough to double the type.
    const pct = Number(backLayout().font.message.replace("cqw", ""));
    expect(pct).toBeGreaterThan(2.25);
    expect(pct).toBeLessThan(2.35);
  });

  test("the address block is set larger than the message, as on paper", () => {
    const layout = backLayout();
    expect(Number(layout.font.address.replace("cqw", ""))).toBeGreaterThan(
      Number(layout.font.message.replace("cqw", "")),
    );
  });
});
