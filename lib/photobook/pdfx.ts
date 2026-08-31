/**
 * PDF/X: what this writer achieves, and what it does not.
 *
 * This module exists because the honest answer is uncomfortable and needs to
 * be written down somewhere the code can enforce it, rather than promised in a
 * README and discovered on printed paper.
 *
 * **What the writer emits natively.** A structurally correct PDF 1.4 with
 * MediaBox, TrimBox and BleedBox on every page, no transparency anywhere, no
 * annotations, no JavaScript, no encryption, an Info dictionary with
 * `/Trapped`, and an XMP metadata packet. Photographs are embedded as
 * DCTDecode with the JPEG's own colour model. If an ICC output profile is
 * supplied it is embedded as a real `/OutputIntents` entry.
 *
 * **What it does not, and cannot without help.**
 *
 *  1. **Fonts are not embedded.** The layouts use the base-14 Helvetica faces,
 *     which every PDF consumer has and every part of PDF/X forbids. Embedding
 *     would mean vendoring a licensed TrueType file and writing a font
 *     subsetter — real work, and pointless as long as (2) stands.
 *  2. **The page content is RGB.** Converting an RGB photograph to CMYK needs
 *     a colour engine driving two ICC profiles with a rendering intent and
 *     black generation. There is no correct way to do that in a few hundred
 *     lines, and an *incorrect* way — the naive `k = 1 - max(r,g,b)`
 *     conversion — produces colours that look plausible on screen and muddy on
 *     paper. Refusing to do it badly is the whole point.
 *  3. **Therefore no PDF/X version is stamped by default.** A file claiming
 *     `GTS_PDFXVersion` that a preflight then fails is worse than a file that
 *     claims nothing, because the claim is what stops anyone checking.
 *
 * **The remedy, which is one command.** Ghostscript converts to PDF/X-1a with
 * CMYK separation, embedded fonts and an output intent in a single pass, using
 * the ICC profile the printer names. `ghostscriptCommand()` below builds it.
 * That is a deploy-time dependency (`apt install ghostscript`), not a runtime
 * one, and it is not required to produce a book — only to produce one that
 * satisfies the strictest providers' preflight.
 *
 * Nothing here has been verified against a preflight tool, because there is no
 * preflight tool on this machine and no account to submit a file to. Every
 * claim is therefore stated as what the code does, not as a certification.
 */

import type { OutputIntent } from "../postcard/pdf.ts";

export type PdfxTarget = "PDF/X-1a:2001" | "PDF/X-3:2002" | "PDF/X-4";

export type Requirement = {
  requirement: string;
  met: boolean;
  detail: string;
};

export type PdfxReadiness = {
  target: PdfxTarget;
  requirements: Requirement[];
  /** True only when every requirement is met. Gates `pdfxVersion` on the
   * document, which is the only place that flag may come from. */
  claimable: boolean;
  /** Set on the PDF when claimable; undefined otherwise. */
  version?: string;
};

/**
 * An honest audit of the file this writer is about to produce.
 *
 * `claimable` is deliberately hard to make true: it needs an embedded output
 * intent *and* embedded fonts *and* CMYK content, and the writer can only ever
 * supply the first. It is written this way so that the day font embedding
 * lands, the answer changes by itself rather than by someone editing a string.
 */
export function pdfxReadiness(state: {
  outputIntent: boolean;
  fontsEmbedded: boolean;
  cmykContent: boolean;
  transparency: boolean;
}): PdfxReadiness {
  const requirements: Requirement[] = [
    {
      requirement: "TrimBox and BleedBox on every page",
      met: true,
      detail: "Written by lib/postcard/pdf.ts for every page this book emits.",
    },
    {
      requirement: "No transparency, no annotations, no encryption",
      met: !state.transparency,
      detail: "The writer has no operator that produces any of them.",
    },
    {
      requirement: "Info dictionary with /Trapped and an XMP packet",
      met: true,
      detail: "Emitted whenever document options are passed.",
    },
    {
      requirement: "OutputIntent with an embedded ICC profile",
      met: state.outputIntent,
      detail: state.outputIntent
        ? "An ICC profile was supplied and embedded as DestOutputProfile."
        : "No ICC profile supplied. Pass --icc <profile.icc> — the printer names which one.",
    },
    {
      requirement: "All fonts embedded and subset",
      met: state.fontsEmbedded,
      detail: state.fontsEmbedded
        ? "Font programs embedded."
        : "Base-14 Helvetica is referenced, not embedded. Ghostscript embeds it; see ghostscriptCommand().",
    },
    {
      requirement: "Colour is CMYK or spot only (PDF/X-1a)",
      met: state.cmykContent,
      detail: state.cmykContent
        ? "All content and images are CMYK."
        : "Content is DeviceRGB. Converting needs a colour engine; see the note at the top of this file.",
    },
  ];
  const claimable = requirements.every((r) => r.met);
  return {
    target: "PDF/X-1a:2001",
    requirements,
    claimable,
    version: claimable ? "PDF/X-1a:2001" : undefined,
  };
}

// ---------------------------------------------------------------------------
// ICC profiles
// ---------------------------------------------------------------------------

const COLOUR_SPACES: Record<string, number> = {
  CMYK: 4,
  "RGB ": 3,
  GRAY: 1,
};

export type IccProfile = {
  bytes: Uint8Array;
  /** 'CMYK', 'RGB ', 'GRAY' … as written in the header. */
  colourSpace: string;
  components: number;
  /** The profile's own description, when it carries a readable one. */
  description: string;
};

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.slice(at, at + length));
}

function uint32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

/**
 * Reads enough of an ICC profile to know it is one, and what it describes.
 *
 * Validating rather than trusting: pointing `--icc` at an sRGB profile and
 * getting a book prepared for the wrong colour space is exactly the failure
 * that only shows up on paper, and the header says which it is in four bytes.
 */
export function readIcc(bytes: Uint8Array): IccProfile {
  if (bytes.length < 132 || ascii(bytes, 36, 4) !== "acsp") {
    throw new Error("Not an ICC profile (no 'acsp' signature at byte 36).");
  }
  const colourSpace = ascii(bytes, 16, 4);
  const components = COLOUR_SPACES[colourSpace];
  if (!components) {
    throw new Error(`ICC profile data colour space is "${colourSpace}", which this writer cannot declare.`);
  }

  let description = "";
  const tagCount = uint32(bytes, 128);
  for (let i = 0; i < Math.min(tagCount, 200); i++) {
    const at = 132 + i * 12;
    if (ascii(bytes, at, 4) !== "desc") continue;
    const offset = uint32(bytes, at + 4);
    const type = ascii(bytes, offset, 4);
    if (type === "desc") {
      const length = uint32(bytes, offset + 8);
      description = ascii(bytes, offset + 12, Math.max(0, length - 1));
    } else if (type === "mluc") {
      // ICC v4: UTF-16BE, first record.
      const length = uint32(bytes, offset + 20);
      const start = offset + uint32(bytes, offset + 24);
      let out = "";
      for (let k = 0; k + 1 < length; k += 2) {
        out += String.fromCharCode((bytes[start + k] << 8) | bytes[start + k + 1]);
      }
      description = out;
    }
    break;
  }

  return { bytes, colourSpace, components, description: description.replace(/\0+$/, "") };
}

/** Turns a validated profile into the document's output intent. */
export function outputIntentFor(profile: IccProfile, identifier?: string): OutputIntent {
  return {
    identifier: identifier ?? profile.description ?? "Custom",
    info: profile.description || "Embedded ICC output profile",
    registryName: "http://www.color.org",
    profile: profile.bytes,
    components: profile.components,
  };
}

// ---------------------------------------------------------------------------
// The Ghostscript step
// ---------------------------------------------------------------------------

/**
 * The PostScript prologue Ghostscript wants for PDF/X output.
 *
 * Ghostscript will not invent an output intent, so this file supplies one from
 * the same ICC profile the writer embeds. Written next to the book so the
 * command below is runnable as printed, with nothing to fill in.
 */
export function pdfxDefPs(iccPath: string, condition: string, title: string): string {
  const escape = (s: string) => s.replace(/([()\\])/g, "\\$1");
  return `%!
% PDF/X definition for Ghostscript, generated by Fernscout.
% Used by: gs -dPDFX -dBATCH -dNOPAUSE ... PDFX_def.ps book.pdf
[ /Title (${escape(title)}) /DOCINFO pdfmark
[ /GTS_PDFXVersion (PDF/X-1a:2001) /DOCINFO pdfmark
[ /Trapped /False /DOCINFO pdfmark

/ICCProfile (${escape(iccPath)}) def

[/_objdef {icc_PDFX} /type /stream /OBJ pdfmark
[{icc_PDFX} <</N systemdict /ProcessColorModel known {
    systemdict /ProcessColorModel get dup /DeviceGray eq
    { pop 1 } { /DeviceCMYK eq { 4 } { 3 } ifelse } ifelse
  } { 4 } ifelse >> /PUT pdfmark
[{icc_PDFX} ICCProfile (r) file /PUT pdfmark
[/_objdef {OutputIntent_PDFX} /type /dict /OBJ pdfmark
[{OutputIntent_PDFX} <<
  /Type /OutputIntent
  /S /GTS_PDFX
  /OutputCondition (${escape(condition)})
  /OutputConditionIdentifier (${escape(condition)})
  /RegistryName (http://www.color.org)
  /DestOutputProfile {icc_PDFX}
>> /PUT pdfmark
[{Catalog} <</OutputIntents [ {OutputIntent_PDFX} ]>> /PUT pdfmark
`;
}

/**
 * The one command that closes every gap this writer leaves open.
 *
 * `-dPDFX` makes Ghostscript enforce the standard rather than merely aim at
 * it: it embeds the base-14 fonts, converts DeviceRGB to the output intent's
 * space, flattens anything that needs flattening, and fails loudly on what it
 * cannot fix. `-dRenderIntent=1` is relative colorimetric with black point
 * compensation, which is the right default for photographs on coated stock.
 */
export function ghostscriptCommand(input: {
  pdf: string;
  out: string;
  defPs: string;
  icc: string;
}): string[] {
  return [
    "gs",
    "-dPDFX",
    "-dBATCH",
    "-dNOPAUSE",
    "-dNOOUTERSAVE",
    "-sDEVICE=pdfwrite",
    "-dPDFSETTINGS=/prepress",
    "-dCompatibilityLevel=1.4",
    "-sColorConversionStrategy=CMYK",
    "-sProcessColorModel=DeviceCMYK",
    `-sOutputICCProfile=${input.icc}`,
    "-dRenderIntent=1",
    "-dEmbedAllFonts=true",
    "-dSubsetFonts=true",
    "-dAutoRotatePages=/None",
    "-dDownsampleColorImages=false",
    `-sOutputFile=${input.out}`,
    input.defPs,
    input.pdf,
  ];
}

/** The readiness report as lines for a terminal or a text file. */
export function readinessReport(readiness: PdfxReadiness): string[] {
  const lines = [`PDF/X readiness — target ${readiness.target}`, ""];
  for (const r of readiness.requirements) {
    lines.push(`  [${r.met ? "x" : " "}] ${r.requirement}`);
    lines.push(`      ${r.detail}`);
  }
  lines.push("");
  lines.push(
    readiness.claimable
      ? `This file declares ${readiness.version}.`
      : "This file declares no PDF/X version, because it does not meet one. " +
          "Run the Ghostscript command in gs-pdfx.sh to produce one that does.",
  );
  return lines;
}
