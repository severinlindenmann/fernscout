import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  A6_LANDSCAPE,
  DIVIDER_X_MM,
  FIGURES_AREA,
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
import { makeJpeg, withExif } from "./support/exif-jpeg";

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

  // B698. A phone writes a portrait picture as landscape pixels and a tag
  // saying which way up the camera was; the frame header alone therefore
  // called half of everybody's photographs landscape, and the planner built a
  // landscape frame around an upright picture.
  test("a photograph the camera rotated reports the size it is seen at", async () => {
    const sideways = withExif(await makeJpeg(1, 400, 300), { orientation: 6 });
    const image = readJpeg(new Uint8Array(sideways));
    expect([image.width, image.height]).toEqual([300, 400]);
    // The stream is still the camera's own bytes, and the XObject has to say
    // what they decode to.
    expect([image.pixelWidth, image.pixelHeight]).toEqual([400, 300]);
    expect(image.orientation).toBe(6);
  });

  test("a photograph with no EXIF at all is the right way up", async () => {
    const image = readJpeg(new Uint8Array(await makeJpeg(2, 400, 300)));
    expect([image.width, image.height]).toEqual([400, 300]);
    expect(image.orientation).toBe(1);
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

  /**
   * B982 — the card the printer receives carries no address at all.
   *
   * Stannp is handed the recipient as `recipient[...]` fields and lays down
   * its own address block and postal indicia. A back with ours already on it
   * came back with the two overprinted, one name written across the other, on
   * a card somebody had paid for. `lib/postcard/send.ts` is what asks for this
   * copy; the proof and the receipt attachment still get the addressed one.
   */
  test("the printer's copy has no address on it", () => {
    const text = Buffer.from(
      render({ sides: "back", address: "printer" }).pdf,
    ).toString("latin1");
    for (const line of ["Frau Maria Muster", "Bahnhofstrasse 12", "8001 Zurich", "Schweiz"]) {
      expect(text).not.toContain(line);
    }
  });

  test("nor the empty stamp box, which is where their indicia goes", () => {
    // The box is four hairlines and nothing else on that half of the card, so
    // the drawn back is strictly shorter without it.
    const drawn = render({ sides: "back" }).pdf.length;
    const printer = render({ sides: "back", address: "printer" }).pdf.length;
    expect(printer).toBeLessThan(drawn);
  });

  test("the message and the signature are untouched by it", () => {
    const text = Buffer.from(
      render({ sides: "back", address: "printer" }).pdf,
    ).toString("latin1");
    expect(text).toContain("Hello from the road.");
    expect(text).toContain("Us");
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
 * B627 — a portrait photograph on a landscape card, and where the owner's
 * drag lands.
 *
 * The one thing worth a runnable check here is that the fraction pair a
 * drag produces maps to the same rectangle the preview's CSS `objectPosition`
 * would compute — `(box - image) * x` on the horizontal axis, `(box - image)
 * * (1 - y)` on the vertical, because PDF space counts up from the bottom and
 * CSS counts down from the top (see `lib/photobook/plan.ts`'s `cover()`,
 * B513's answer to the same problem). An absent crop is centre, which is
 * every card printed before this existed.
 */
/**
 * B698: the picture goes into the page the way a person sees it, not the way
 * the sensor read it. Both halves matter — the *rectangle* has the upright
 * aspect ratio, and the *bytes* are turned to match it. Either one alone is a
 * photograph stretched across a frame it does not fit.
 */
describe("a photograph the camera rotated — B698", () => {
  /** Every operand of the `cm` the front photograph is drawn with. */
  function frontMatrix(pdf: Uint8Array): number[] {
    const text = Buffer.from(pdf).toString("latin1");
    const match = text.match(
      /q (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm \/Im1 Do Q/,
    );
    if (!match) throw new Error("no drawImage operator found");
    return match.slice(1).map(Number);
  }

  test("is placed exactly as an upright photograph of the same shape", async () => {
    const rotated = withExif(await makeJpeg(3, 400, 300), { orientation: 6 });
    const upright = await makeJpeg(3, 300, 400);
    const [a, b, c, d, e, f] = frontMatrix(render({ photo: rotated }).pdf);
    const [w, , , h, x, y] = frontMatrix(render({ photo: upright }).pdf);

    // A quarter turn clockwise: both operands have moved onto the other
    // diagonal, and the height is negative because the picture now runs down
    // the page rather than up it. The rectangle itself is the upright one.
    expect(a).toBe(0);
    expect(d).toBe(0);
    expect(c).toBeCloseTo(w, 3);
    expect(-b).toBeCloseTo(h, 3);
    expect(e).toBeCloseTo(x, 3);
    expect(f).toBeCloseTo(y + h, 3);
  });
});

describe("the front photograph's crop — B627", () => {
  /** The operand a `cm` matrix draws with `drawImage`, straight off the
   * operations list rather than parsed pixel-for-pixel — the geometry is what
   * this checks, not the byte layout of the page content stream. */
  function frontCm(pdf: Uint8Array): { w: number; h: number; x: number; y: number } {
    const text = Buffer.from(pdf).toString("latin1");
    const match = text.match(
      /q ([\d.]+) 0\.000 0\.000 ([\d.]+) (-?[\d.]+) (-?[\d.]+) cm \/Im1 Do Q/,
    );
    if (!match) throw new Error("no drawImage operator found");
    const [, w, h, x, y] = match.map(Number);
    return { w, h, x, y };
  }

  test("absent crops from the centre, same as before B627", () => {
    const centred = frontCm(render().pdf);
    const explicit = frontCm(render({ crop: { x: 0.5, y: 0.5 } }).pdf);
    expect(centred).toEqual(explicit);
  });

  // `01.jpg` (1600×1067) is wider, relative to its height, than the A6
  // landscape box — so scaling it to cover leaves no vertical overflow to
  // crop at all, and only `x` moves anything. A generated portrait photo is
  // what exercises the axis that photo cannot.
  test("never scales anisotropically: only the horizontal position moves, not the size", () => {
    const centre = frontCm(render().pdf);
    const corner = frontCm(render({ crop: { x: 0, y: 0 } }).pdf);
    expect(corner.w).toBeCloseTo(centre.w, 6);
    expect(corner.h).toBeCloseTo(centre.h, 6);
    expect(corner.x).not.toBeCloseTo(centre.x, 3);
  });

  test("x is not flipped: x: 0 keeps the left, x: 1 keeps the right", () => {
    const left = frontCm(render({ crop: { x: 0, y: 0.5 } }).pdf).x;
    const right = frontCm(render({ crop: { x: 1, y: 0.5 } }).pdf).x;
    // Keeping the left pushes the excess width to the right, i.e. the drawn
    // rectangle's left edge is nearer 0 (less negative) than keeping the
    // right, which pushes the whole rectangle further negative.
    expect(left).toBeGreaterThan(right);
  });

  // A portrait photograph on a landscape card is the ticket's own case: to
  // cover the box its width matches exactly and only the height overflows,
  // so this is what actually exercises the vertical axis — `01.jpg` above,
  // being wider than the box, never does.
  test("a portrait photograph on the landscape card: only the vertical crop moves", async () => {
    const portrait = await makeJpeg(1, 600, 1200);
    const withCrop = (crop: { x: number; y: number }) =>
      frontCm(render({ photo: portrait, crop }).pdf);

    // Never anisotropic: the same scale whatever the crop.
    const a = withCrop({ x: 0.5, y: 0.5 });
    const b = withCrop({ x: 0.1, y: 0.9 });
    expect(b.w).toBeCloseTo(a.w, 6);
    expect(b.h).toBeCloseTo(a.h, 6);

    // `y: 0` (drag says "keep the top") means the drawn rectangle's top edge
    // sits at the box's own top, pushing the whole excess height below the
    // box — page space counts up from the bottom, so that is the *smallest*
    // (most negative) value drawImage's own y can take. `y: 1` ("keep the
    // bottom") aligns the rectangle's bottom edge with the box's, i.e. `0`
    // on that axis — the largest value.
    const top = withCrop({ x: 0.5, y: 0 });
    const bottom = withCrop({ x: 0.5, y: 1 });
    expect(bottom.y).toBeGreaterThan(top.y);

    // No horizontal overflow to crop at all, so a portrait photo's own width
    // covers the box exactly whatever `x` says.
    expect(top.x).toBeCloseTo(0, 6);
  });

  // The rectangle the owner drags is a zoom as well as a position — B627's
  // second half. What must hold is that it scales both sides by one factor
  // and leaves the anchored point of the photograph where it was on the card.
  test("zoom scales both sides by the same factor, and never below the box", () => {
    const plain = frontCm(render({ crop: { x: 0.5, y: 0.5 } }).pdf);
    const close = frontCm(render({ crop: { x: 0.5, y: 0.5, zoom: 2 } }).pdf);
    // Two decimals, not more: the operands are written into the page stream
    // rounded to thousandths.
    expect(close.w).toBeCloseTo(plain.w * 2, 2);
    expect(close.h).toBeCloseTo(plain.h * 2, 2);

    // A zoom below 1 would leave the card short of photograph; the renderer
    // refuses it rather than letterboxing, the same way the drag handler does.
    const out = frontCm(render({ crop: { x: 0.5, y: 0.5, zoom: 0.25 } }).pdf);
    expect(out).toEqual(plain);
  });

  test("the anchored point stays put on the card whatever the zoom", () => {
    // The point of the photograph at `x` sits at fraction `x` across the
    // card: rect.x + x · rect.width is the same page coordinate at any zoom,
    // which is what lets the browser preview it with `transform-origin`.
    const at = (zoom: number) => {
      const r = frontCm(render({ crop: { x: 0.25, y: 0.5, zoom } }).pdf);
      return r.x + 0.25 * r.w;
    };
    expect(at(3)).toBeCloseTo(at(1), 2);
  });

  test("a zoomed crop reports the resolution it actually prints", () => {
    const photo = render({ crop: { x: 0.5, y: 0.5 } }).photo;
    const zoomed = render({ crop: { x: 0.5, y: 0.5, zoom: 2 } }).photo;
    // Same file, half the pixels across the card.
    expect(zoomed.width).toBe(photo.width);
    expect(zoomed.effectiveDpi).toBeLessThan(photo.effectiveDpi);
    expect(Math.abs(zoomed.effectiveDpi - photo.effectiveDpi / 2)).toBeLessThan(1);
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

/**
 * B628 — the traveller figures beside the signature, off by default.
 *
 * `renderPostcard`'s content streams are plain text (no `FlateDecode`), so a
 * figure painted with `PdfBuilder.drawPath`'s "f"/"B" fill operators is
 * findable as a substring — the cheapest possible proof that something new
 * was actually drawn, without reaching into `Page.operations` and coupling
 * the test to render.ts's internals.
 */
describe("traveller figures on the back", () => {
  const party = [{ skin: "medium" as const, hair: "black" as const }];

  test("absent by default: the back is byte-for-byte what it was before", () => {
    const withoutField = render();
    const explicitlyEmpty = render({ figures: [] });
    expect(withoutField.pdf).toEqual(explicitlyEmpty.pdf);
  });

  test("switched on, the party is drawn — the PDF gains fill paths", () => {
    const off = render();
    const on = render({ figures: party });
    expect(on.pdf.length).toBeGreaterThan(off.pdf.length);
    // A figure fills more than a dozen shapes (limbs, head, pack, shadow);
    // that shows up as many more "f Q" / "B Q" fill-and-restore pairs than
    // the handful the rest of the back already draws (rules, stamp box).
    const fills = (bytes: Uint8Array) =>
      (Buffer.from(bytes).toString("latin1").match(/ (f|B) Q/g) ?? []).length;
    expect(fills(on.pdf)).toBeGreaterThan(fills(off.pdf) + 5);
  });

  test("an empty party draws nothing, same as the switch being off", () => {
    const off = render();
    const empty = render({ figures: [] });
    expect(empty.pdf).toEqual(off.pdf);
  });

  test("the figures box sits fully inside the safe area", () => {
    const spec = A6_LANDSCAPE;
    const left = DIVIDER_X_MM - FIGURES_AREA.gapFromDividerMm - FIGURES_AREA.widthMm;
    const right = left + FIGURES_AREA.widthMm;
    const bottom = spec.safeMm + 1;
    const top = bottom + FIGURES_AREA.heightMm;

    expect(left).toBeGreaterThanOrEqual(spec.safeMm);
    expect(right).toBeLessThanOrEqual(DIVIDER_X_MM); // never crosses the divider
    expect(right).toBeLessThanOrEqual(spec.trimWidthMm - spec.safeMm);
    expect(bottom).toBeGreaterThanOrEqual(spec.safeMm);
    expect(top).toBeLessThanOrEqual(spec.trimHeightMm - spec.safeMm);
  });
});
