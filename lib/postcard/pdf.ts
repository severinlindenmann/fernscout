/**
 * A very small PDF writer, sufficient for print-ready postcards and books.
 *
 * Deliberately dependency-free. Every JavaScript PDF library is either large or
 * brings a native module with it, and a self-hoster should not need a compiler
 * to print a postcard. What a postcard actually requires is narrow: two pages
 * at an exact size, one photograph per side, some text, a few rules, and — the
 * part that makes a PDF print-ready rather than merely correct — TrimBox and
 * BleedBox, so the printer knows where to cut.
 *
 * JPEGs are embedded byte-for-byte as DCTDecode streams, so the photograph is
 * never re-encoded and loses nothing on the way to paper.
 *
 * A photobook (lib/photobook/) needs four things a postcard does not, all of
 * them additive and all of them off unless asked for:
 *
 *  - **Clipping**, so a photograph can fill a grid cell without spilling into
 *    the next one.
 *  - **Vector paths**, for the route map.
 *  - **Document metadata** — Info dictionary and XMP — which every print
 *    provider's preflight looks at first.
 *  - **An output intent**, the ICC profile that says which press and paper the
 *    colours were prepared for. See docs/providers/photobook.md for exactly how
 *    far that gets us, and where it stops.
 */

type Rgb = { r: number; g: number; b: number };

export type JpegImage = {
  data: Uint8Array;
  width: number;
  height: number;
  /** 1 = grayscale, 3 = RGB, 4 = CMYK. */
  components: number;
};

/**
 * Reads dimensions and colour model straight out of a JPEG's frame header.
 *
 * Throws rather than guessing: a wrong size here means a photograph silently
 * stretched on a printed card, which is the kind of error nobody notices until
 * fifty of them arrive in the post.
 */
export function readJpeg(bytes: Uint8Array): JpegImage {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("Not a JPEG (missing SOI marker). Only JPEG photos are supported.");
  }
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    // Start-of-frame markers, excluding the ones that are not frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      const components = bytes[i + 9];
      return { data: bytes, width, height, components };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length <= 0) throw new Error("Malformed JPEG segment length.");
    i += 2 + length;
  }
  throw new Error("Malformed JPEG: no frame header found.");
}

/** Anything outside WinAnsi's printable range, which the base-14 fonts encode. */
const NON_WIN_ANSI = /[^\u0020-\u007E\u0080-\u00FF]/g;

function pdfString(text: string): string {
  return text
    .replace(NON_WIN_ANSI, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/** Escapes for an XMP/XML text node. */
function xmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const F = (n: number) => n.toFixed(3);

/** The three base-14 faces the layouts use. */
export type FontName = "F1" | "F2" | "F3";

const FONTS: Record<FontName, string> = {
  F1: "Helvetica",
  F2: "Helvetica-Bold",
  F3: "Helvetica-Oblique",
};

export type Page = {
  width: number;
  height: number;
  /** Where the card is cut, inset from the media box by the bleed. */
  trim?: { x: number; y: number; width: number; height: number };
  operations: string[];
  images: { name: string; image: JpegImage }[];
};

/**
 * The colour space this document promises the press.
 *
 * `profile` is the raw bytes of an ICC output profile — the one the printer
 * names, for example a FOGRA characterisation for European coated stock. When
 * it is supplied the document carries a real `/OutputIntents` entry; when it is
 * not, nothing is written, because a PDF that *claims* an output condition it
 * cannot substantiate is worse than one that claims nothing.
 */
export type OutputIntent = {
  /** e.g. "FOGRA39L" or "Coated FOGRA39 (ISO 12647-2:2004)". */
  identifier: string;
  info: string;
  registryName?: string;
  profile: Uint8Array;
  /** Colour components in the profile: 4 for CMYK, 3 for RGB, 1 for grey. */
  components: number;
};

export type PdfDocumentOptions = {
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
  producer?: string;
  /** ISO date-time. Passed in rather than read from the clock so that two runs
   * over the same content produce the same file. */
  created?: Date;
  outputIntent?: OutputIntent;
  /**
   * Stamped as `/GTS_PDFXVersion`. **Only pass this when the document really
   * does meet the named part**, which for this writer means at minimum an
   * embedded output intent — see `pdfxReadiness()` in lib/photobook/pdfx.ts,
   * which is the only thing that should ever set it.
   */
  pdfxVersion?: string;
};

type Chunk = string | Uint8Array;

export class PdfBuilder {
  private pages: Page[] = [];
  private options: PdfDocumentOptions;

  constructor(options: PdfDocumentOptions = {}) {
    this.options = options;
  }

  addPage(width: number, height: number, trim?: Page["trim"]): Page {
    const page: Page = { width, height, trim, operations: [], images: [] };
    this.pages.push(page);
    return page;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  static drawImage(page: Page, image: JpegImage, x: number, y: number, w: number, h: number) {
    const name = `Im${page.images.length + 1}`;
    page.images.push({ name, image });
    page.operations.push(`q ${F(w)} 0 0 ${F(h)} ${F(x)} ${F(y)} cm /${name} Do Q`);
  }

  /**
   * Draws an image cropped to a rectangle.
   *
   * The image rectangle may be larger than the clip — that is exactly what a
   * cover-crop is — and everything outside the clip is discarded by the
   * renderer rather than painted over, so nothing overlaps the neighbouring
   * cell of a grid.
   */
  static drawImageClipped(
    page: Page,
    image: JpegImage,
    clip: { x: number; y: number; width: number; height: number },
    draw: { x: number; y: number; width: number; height: number },
  ) {
    const name = `Im${page.images.length + 1}`;
    page.images.push({ name, image });
    page.operations.push(
      `q ${F(clip.x)} ${F(clip.y)} ${F(clip.width)} ${F(clip.height)} re W n ` +
        `${F(draw.width)} 0 0 ${F(draw.height)} ${F(draw.x)} ${F(draw.y)} cm /${name} Do Q`,
    );
  }

  static drawRect(page: Page, x: number, y: number, w: number, h: number, color: Rgb) {
    page.operations.push(
      `q ${color.r} ${color.g} ${color.b} rg ${F(x)} ${F(y)} ${F(w)} ${F(h)} re f Q`,
    );
  }

  static drawLine(
    page: Page,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    color: Rgb,
  ) {
    page.operations.push(
      `q ${color.r} ${color.g} ${color.b} RG ${F(width)} w ${F(x1)} ${F(y1)} m ${F(x2)} ${F(y2)} l S Q`,
    );
  }

  static drawCircle(page: Page, cx: number, cy: number, r: number, fill: Rgb) {
    // Four Béziers; 0.5523 is the usual circle-from-curves constant.
    const k = r * 0.5523;
    page.operations.push(
      `q ${fill.r} ${fill.g} ${fill.b} rg ${F(cx + r)} ${F(cy)} m ` +
        `${F(cx + r)} ${F(cy + k)} ${F(cx + k)} ${F(cy + r)} ${F(cx)} ${F(cy + r)} c ` +
        `${F(cx - k)} ${F(cy + r)} ${F(cx - r)} ${F(cy + k)} ${F(cx - r)} ${F(cy)} c ` +
        `${F(cx - r)} ${F(cy - k)} ${F(cx - k)} ${F(cy - r)} ${F(cx)} ${F(cy - r)} c ` +
        `${F(cx + k)} ${F(cy - r)} ${F(cx + r)} ${F(cy - k)} ${F(cx + r)} ${F(cy)} c f Q`,
    );
  }

  /**
   * Draws an arbitrary path given in PDF path syntax ("x y m x y l h").
   *
   * The route map is the only caller: the world outline is baked SVG path data
   * (lib/worldLand.json), and translating it to PDF operators is a great deal
   * less work than rasterising a map.
   */
  static drawPath(
    page: Page,
    path: string,
    style: { fill?: Rgb; stroke?: Rgb; lineWidth?: number },
  ) {
    const prefix: string[] = ["q"];
    if (style.fill) prefix.push(`${style.fill.r} ${style.fill.g} ${style.fill.b} rg`);
    if (style.stroke) {
      prefix.push(`${style.stroke.r} ${style.stroke.g} ${style.stroke.b} RG`);
      prefix.push(`${F(style.lineWidth ?? 0.5)} w`);
      prefix.push("1 J 1 j");
    }
    const paint = style.fill && style.stroke ? "B" : style.fill ? "f" : "S";
    page.operations.push(`${prefix.join(" ")} ${path} ${paint} Q`);
  }

  /** Opens a clipping rectangle. Every `pushClip` needs a matching `popClip`. */
  static pushClip(page: Page, x: number, y: number, w: number, h: number) {
    page.operations.push(`q ${F(x)} ${F(y)} ${F(w)} ${F(h)} re W n`);
  }

  static popClip(page: Page) {
    page.operations.push("Q");
  }

  static drawText(
    page: Page,
    text: string,
    x: number,
    y: number,
    size: number,
    color: Rgb = { r: 0, g: 0, b: 0 },
    font: FontName = "F1",
  ) {
    page.operations.push(
      `BT /${font} ${size.toFixed(2)} Tf ${color.r} ${color.g} ${color.b} rg ` +
        `${F(x)} ${F(y)} Td (${pdfString(text)}) Tj ET`,
    );
  }

  /** Text on its side, for the spine of a book cover. */
  static drawTextRotated(
    page: Page,
    text: string,
    x: number,
    y: number,
    size: number,
    degrees: number,
    color: Rgb = { r: 0, g: 0, b: 0 },
    font: FontName = "F1",
  ) {
    const rad = (degrees * Math.PI) / 180;
    const [c, s] = [Math.cos(rad), Math.sin(rad)];
    page.operations.push(
      `BT /${font} ${size.toFixed(2)} Tf ${color.r} ${color.g} ${color.b} rg ` +
        `${F(c)} ${F(s)} ${F(-s)} ${F(c)} ${F(x)} ${F(y)} Tm (${pdfString(text)}) Tj ET`,
    );
  }

  private xmp(created: Date): string {
    const iso = created.toISOString().replace(/\.\d{3}Z$/, "Z");
    const o = this.options;
    const pdfx = o.pdfxVersion
      ? `\n   <pdfxid:GTS_PDFXVersion>${xmlText(o.pdfxVersion)}</pdfxid:GTS_PDFXVersion>`
      : "";
    return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
   xmlns:dc="http://purl.org/dc/elements/1.1/"
   xmlns:xmp="http://ns.adobe.com/xap/1.0/"
   xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
   xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(o.title ?? "")}</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>${xmlText(o.author ?? "")}</rdf:li></rdf:Seq></dc:creator>
   <xmp:CreateDate>${iso}</xmp:CreateDate>
   <xmp:ModifyDate>${iso}</xmp:ModifyDate>
   <xmp:CreatorTool>${xmlText(o.creator ?? "Fernscout")}</xmp:CreatorTool>
   <pdf:Producer>${xmlText(o.producer ?? "Fernscout photobook")}</pdf:Producer>${pdfx}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  }

  build(): Uint8Array {
    const chunks: Chunk[] = [];
    const offsets: number[] = [];
    let position = 0;

    const push = (text: string) => {
      chunks.push(text);
      position += Buffer.byteLength(text, "latin1");
    };
    const pushBinary = (bytes: Uint8Array) => {
      chunks.push(bytes);
      position += bytes.length;
    };
    const startObject = (n: number) => {
      offsets[n] = position;
      push(`${n} 0 obj\n`);
    };

    push("%PDF-1.4\n");

    const o = this.options;
    const hasMetadata = Object.keys(o).length > 0;
    const created = o.created ?? new Date();

    // 1 catalog, 2 pages, 3–5 fonts, then the optional document-level objects,
    // then per page: page, contents, images.
    let next = 6;
    const infoId = hasMetadata ? next++ : 0;
    const metadataId = hasMetadata ? next++ : 0;
    const intentId = o.outputIntent ? next++ : 0;
    const profileId = o.outputIntent ? next++ : 0;

    const perPage = this.pages.map(() => ({ page: 0, contents: 0, images: [] as number[] }));
    this.pages.forEach((p, i) => {
      perPage[i].page = next++;
      perPage[i].contents = next++;
      p.images.forEach(() => perPage[i].images.push(next++));
    });

    startObject(1);
    push(
      `<< /Type /Catalog /Pages 2 0 R` +
        (metadataId ? ` /Metadata ${metadataId} 0 R` : "") +
        (intentId ? ` /OutputIntents [${intentId} 0 R]` : "") +
        ` >>\nendobj\n`,
    );

    startObject(2);
    push(
      `<< /Type /Pages /Count ${this.pages.length} /Kids [${perPage
        .map((p) => `${p.page} 0 R`)
        .join(" ")}] >>\nendobj\n`,
    );

    (Object.keys(FONTS) as FontName[]).forEach((name, i) => {
      startObject(3 + i);
      push(
        `<< /Type /Font /Subtype /Type1 /BaseFont /${FONTS[name]} ` +
          `/Encoding /WinAnsiEncoding >>\nendobj\n`,
      );
    });

    if (infoId) {
      const stamp = (d: Date) =>
        `D:${d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
      startObject(infoId);
      push(
        `<< /Title (${pdfString(o.title ?? "")}) /Author (${pdfString(o.author ?? "")}) ` +
          `/Subject (${pdfString(o.subject ?? "")}) ` +
          `/Creator (${pdfString(o.creator ?? "Fernscout")}) ` +
          `/Producer (${pdfString(o.producer ?? "Fernscout photobook")}) ` +
          `/CreationDate (${stamp(created)}) /ModDate (${stamp(created)}) ` +
          (o.pdfxVersion ? `/GTS_PDFXVersion (${pdfString(o.pdfxVersion)}) ` : "") +
          `/Trapped /False >>\nendobj\n`,
      );
    }

    if (metadataId) {
      const xmp = this.xmp(created);
      startObject(metadataId);
      push(
        `<< /Type /Metadata /Subtype /XML /Length ${Buffer.byteLength(xmp, "utf8")} >>\n` +
          `stream\n${xmp}\nendstream\nendobj\n`,
      );
    }

    if (intentId && o.outputIntent) {
      const intent = o.outputIntent;
      startObject(intentId);
      push(
        `<< /Type /OutputIntent /S /GTS_PDFX ` +
          `/OutputConditionIdentifier (${pdfString(intent.identifier)}) ` +
          `/Info (${pdfString(intent.info)}) ` +
          (intent.registryName ? `/RegistryName (${pdfString(intent.registryName)}) ` : "") +
          `/DestOutputProfile ${profileId} 0 R >>\nendobj\n`,
      );
      startObject(profileId);
      push(`<< /N ${intent.components} /Length ${intent.profile.length} >>\nstream\n`);
      pushBinary(intent.profile);
      push("\nendstream\nendobj\n");
    }

    this.pages.forEach((p, i) => {
      const ids = perPage[i];
      const xobjects = p.images.map((img, k) => `/${img.name} ${ids.images[k]} 0 R`).join(" ");

      startObject(ids.page);
      const boxes = p.trim
        ? ` /TrimBox [${F(p.trim.x)} ${F(p.trim.y)} ` +
          `${F(p.trim.x + p.trim.width)} ${F(p.trim.y + p.trim.height)}]` +
          ` /BleedBox [0 0 ${F(p.width)} ${F(p.height)}]`
        : "";
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${F(p.width)} ${F(p.height)}]` +
          `${boxes} /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> ` +
          `/XObject << ${xobjects} >> >> /Contents ${ids.contents} 0 R >>\nendobj\n`,
      );

      const content = p.operations.join("\n");
      startObject(ids.contents);
      push(
        `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream\nendobj\n`,
      );

      p.images.forEach((img, k) => {
        const colorSpace =
          img.image.components === 1
            ? "/DeviceGray"
            : img.image.components === 4
              ? "/DeviceCMYK"
              : "/DeviceRGB";
        startObject(ids.images[k]);
        push(
          `<< /Type /XObject /Subtype /Image /Width ${img.image.width} /Height ${img.image.height} ` +
            `/ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode ` +
            `/Length ${img.image.data.length} >>\nstream\n`,
        );
        pushBinary(img.image.data);
        push("\nendstream\nendobj\n");
      });
    });

    const xrefStart = position;
    const objectCount = next;
    push(`xref\n0 ${objectCount}\n0000000000 65535 f \n`);
    for (let n = 1; n < objectCount; n++) {
      push(`${String(offsets[n] ?? 0).padStart(10, "0")} 00000 n \n`);
    }
    push(
      `trailer\n<< /Size ${objectCount} /Root 1 0 R` +
        (infoId ? ` /Info ${infoId} 0 R` : "") +
        ` >>\nstartxref\n${xrefStart}\n%%EOF\n`,
    );

    const buffers = chunks.map((chunk) =>
      typeof chunk === "string" ? Buffer.from(chunk, "latin1") : Buffer.from(chunk),
    );
    return new Uint8Array(Buffer.concat(buffers));
  }
}
