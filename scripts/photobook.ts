/**
 * Turns a trip into a print-ready book.
 *
 *   npm run photobook -- --trip <id>
 *   npm run photobook -- --trip <id> --guides --size landscape-a4
 *   npm run photobook -- --trip <id> --icc "/path/to/FOGRA39.icc"
 *   npm run photobook -- --providers
 *   npm run photobook -- --trip <id> --outline
 *
 * Dry run by default: it writes into content/<user>/photobooks and calls nobody.
 * That is the whole pipeline minus the account, which is deliberate — see
 * docs/providers/photobook.md.
 *
 * Run through `tsx --conditions=react-server` (see package.json). The condition
 * is not decoration: `lib/trips.ts` and friends are marked `server-only`, whose
 * package exports resolve to an empty module under that condition and to a
 * throwing one otherwise. It is the same switch Next flips for server
 * components, used here for the same reason.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { contentRoot } from "../lib/contentRoot.ts";
import { displayPath } from "../lib/displayPath.ts";
import { parseTripRef } from "../lib/trips.ts";
import { buildBookSource, resolvePrintFile } from "../lib/photobook/source.ts";
import { outline, planBook, type Photobook } from "../lib/photobook/plan.ts";
import { renderCover, renderVolume } from "../lib/photobook/render.ts";
import { DEFAULT_OPTIONS } from "../lib/photobook/options.ts";
import { isBookLocale } from "../lib/photobook/strings.ts";
import { renderPreview } from "../lib/photobook/preview.ts";
import { BOOK_SIZES, SADDLE_STITCH, defaultSpec } from "../lib/photobook/spec.ts";
import {
  ghostscriptCommand,
  outputIntentFor,
  pdfxDefPs,
  pdfxReadiness,
  readIcc,
  readinessReport,
} from "../lib/photobook/pdfx.ts";
import {
  CONNECTABLE,
  availableProviders,
  buildRequest,
  type BookOrder,
} from "../lib/photobook/providers.ts";

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const str = (key: string) => (typeof args[key] === "string" ? (args[key] as string) : undefined);

if (args.providers) {
  console.log("Photobook providers:\n");
  for (const [name, state] of Object.entries(availableProviders())) {
    console.log(`  ${state.ready ? "ready      " : "needs setup"}  ${name}\n      ${state.note}\n`);
  }
  console.log("See docs/providers/photobook.md for endpoints, page-count rules and costs.\n");
  process.exit(0);
}

const tripId = str("trip");
if (!tripId) {
  fail(
    "Usage: npm run photobook -- --trip <username>/<trip-id> [--out <dir>] [--guides]\n" +
      "       npm run photobook -- --trip <id> --binding saddle --size portrait-a4\n" +
      "       npm run photobook -- --trip <id> --icc <profile.icc>\n" +
      "       npm run photobook -- --trip <id> --locale de\n" +
      "       npm run photobook -- --trip <id> --outline\n" +
      "       npm run photobook -- --providers\n\n" +
      `Sizes:    ${Object.keys(BOOK_SIZES).join(", ")}\n` +
      "Bindings: perfect (32-160 pages), saddle (4-48, right for a short trip)",
  );
}

// `parseTripRef` is the same check `lib/trips.ts` applies everywhere else a
// ref is trusted with a filesystem path — a username is a directory name and
// therefore a security boundary (AGENTS.md). This does not check that the
// trip *exists*: a photobook run for a journal not yet created is a
// reasonable thing to do, and `buildBookSource` below is what answers that.
const parsedTripRef = parseTripRef(tripId);
if (!parsedTripRef) {
  fail(
    `--trip "${tripId}" is not <username>/<trip-id> — both need to be lowercase ` +
      "letters, digits and dashes, and not start with a dash.",
  );
}

const backend = str("backend") ?? "dry-run";
if (backend !== "dry-run") {
  const state = availableProviders()[backend as keyof ReturnType<typeof availableProviders>];
  fail(
    state
      ? `The "${backend}" backend is not connected yet.\n  ${state.note}\n` +
          "Run without --backend to produce the files, or see docs/providers/photobook.md."
      : `Unknown backend "${backend}". Try --providers.`,
  );
}

const sizeId = str("size") ?? "square-210";
const size = BOOK_SIZES[sizeId];
if (!size) fail(`Unknown size "${sizeId}". One of: ${Object.keys(BOOK_SIZES).join(", ")}`);

const spec = defaultSpec(size);

// Binding decides the page-count rule, and for a short trip it decides whether
// the book ends in twenty blank leaves.
const binding = str("binding") ?? "perfect";
if (binding === "saddle") spec.pageCount = SADDLE_STITCH;
else if (binding !== "perfect") fail(`Unknown binding "${binding}". One of: perfect, saddle`);
// A finished book belongs to whoever it is about, next to their content and
// their postcards, rather than in a directory shared by everyone on the
// instance (decision 23). Gitignored there.
//
// The default is built from `contentRoot()`, never `process.cwd()`: on a
// deployed instance the content root is under DATA_DIR and the working
// directory is the checkout, so the working directory puts a book — and the
// provider request JSON beside it — inside the directory `git pull` runs in
// and outside the backup (B219, and B111 before it).
//
// `--out` is unchanged and still means what it says: a path the person typed,
// resolved against where they are standing, anywhere they like. Only the
// default moved.
const bookOwner = parsedTripRef.username;
const outDir = path.resolve(str("out") ?? path.join(contentRoot(), bookOwner, "photobooks"));
fs.mkdirSync(outDir, { recursive: true });

// ---- the colour profile, if one was supplied -------------------------------

let outputIntent: ReturnType<typeof outputIntentFor> | undefined;
const iccPath = str("icc");
if (iccPath) {
  let icc;
  try {
    icc = readIcc(new Uint8Array(fs.readFileSync(iccPath)));
  } catch (err) {
    fail(`Could not use ${iccPath}: ${(err as Error).message}`);
  }
  if (icc.colourSpace !== "CMYK") {
    console.warn(
      `! ${iccPath} is a ${icc.colourSpace.trim()} profile, not CMYK.\n` +
        "  A print output intent should describe the press, which is CMYK. Continuing, " +
        "but check this is what you meant.",
    );
  }
  outputIntent = outputIntentFor(icc, str("icc-condition"));
  console.log(`Output intent: ${icc.description || iccPath} (${icc.colourSpace.trim()})\n`);
}

// ---- plan ------------------------------------------------------------------

const source = buildBookSource(tripId, { madeOn: str("made-on") });
// The book's own words. `--locale de` prints German headings over the same
// days; the days themselves are printed in whatever language they were
// written in, which is the author's business and not a flag's.
const locale = str("locale") ?? "en";
if (!isBookLocale(locale)) {
  fail(`Unknown --locale "${locale}". One of: en, de, hu.`);
}
const book: Photobook = planBook(source, spec, { ...DEFAULT_OPTIONS, locale });

if (args.outline) {
  for (const volume of book.volumes) {
    console.log(`\n${volume.title} — ${volume.interiorPages} pages\n`);
    for (const line of outline(volume)) console.log(line);
  }
  process.exit(0);
}

// ---- what this file honestly is --------------------------------------------

const readiness = pdfxReadiness({
  outputIntent: Boolean(outputIntent),
  // Both false, and see lib/photobook/pdfx.ts for exactly why.
  fontsEmbedded: false,
  cmykContent: false,
  transparency: false,
});

const document = {
  title: book.title,
  author: source.travellers.join(" & "),
  subject: `${source.trip.start} to ${source.trip.end}`,
  creator: "Fernscout photobook",
  outputIntent,
  pdfxVersion: readiness.version,
};

// ---- render ----------------------------------------------------------------

// `BookPhoto.file` is content-root-relative so the plan is the same JSON on
// every machine (B25); this is where it becomes a file again.
const loadImage = (file: string) => new Uint8Array(fs.readFileSync(resolvePrintFile(file)));
const written: string[] = [];
const md5 = (bytes: Uint8Array) => crypto.createHash("md5").update(bytes).digest("hex");

const write = (name: string, data: Uint8Array | string) => {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, data);
  written.push(displayPath(file));
  return file;
};

console.log(`${book.title}\n${size.name} · ${book.photoCount} photographs\n`);

/** One entry per volume — each is a separate book, and gets its own order. */
const built: { stem: string; pageCount: number; interiorMd5: string; coverMd5: string }[] = [];

// The trip's own id, without the owner: the owner is already the directory.
const bookSlug = parsedTripRef.tripId;

for (const volume of book.volumes) {
  const stem = book.volumes.length > 1 ? `${bookSlug}-v${volume.index}` : bookSlug;
  const interior = renderVolume(volume, spec, { loadImage, guides: args.guides === true, document });
  const cover = renderCover(volume, spec, { loadImage, guides: args.guides === true, document });

  write(`${stem}-interior.pdf`, interior.pdf);
  write(`${stem}-cover.pdf`, cover.pdf);
  built.push({
    stem,
    pageCount: volume.interiorPages,
    interiorMd5: md5(interior.pdf),
    coverMd5: md5(cover.pdf),
  });

  console.log(
    `  Volume ${volume.index}/${volume.of}: ${volume.interiorPages} pages, ` +
      `spine ${volume.spineWidthMm.toFixed(1)} mm, ` +
      `${(interior.pdf.length / 1_000_000).toFixed(1)} MB`,
  );
  for (const miss of [...interior.missing, ...cover.missing]) console.log(`      ! ${miss}`);
}

write(`${bookSlug}-preview.html`, renderPreview(book, outDir, resolvePrintFile));
write(
  `${bookSlug}-plan.json`,
  JSON.stringify({ spec: book.spec, warnings: book.warnings, volumes: book.volumes }, null, 2) + "\n",
);
write(`${bookSlug}-pdfx.txt`, readinessReport(readiness).join("\n") + "\n");

// ---- provider requests, built and not sent ---------------------------------

// The URLs are the load-bearing part: all four providers *fetch* the PDF
// rather than accepting an upload, so a real order needs the files reachable
// on the internet. The placeholders below say where they would have to be.
const base = source.siteUrl ?? "https://example.invalid";
for (const volume of built) {
  const order: BookOrder = {
    reference: `${volume.stem}-${source.madeOn}`,
    title: book.title,
    interiorUrl: `${base}/books/${volume.stem}-interior.pdf`,
    coverUrl: `${base}/books/${volume.stem}-cover.pdf`,
    interiorMd5: volume.interiorMd5,
    coverMd5: volume.coverMd5,
    pageCount: volume.pageCount,
    trimWidthMm: size.trimWidthMm,
    trimHeightMm: size.trimHeightMm,
    copies: Number(str("copies") ?? 5),
    to: {
      name: "RECIPIENT_NAME",
      line1: "RECIPIENT_STREET",
      postcode: "RECIPIENT_POSTCODE",
      city: "RECIPIENT_CITY",
      country: "CH",
      email: "RECIPIENT_EMAIL",
    },
    test: true,
  };
  for (const provider of CONNECTABLE) {
    write(
      `${volume.stem}-${provider}-request.json`,
      JSON.stringify(buildRequest(provider, order), null, 2) + "\n",
    );
  }
}

// ---- the Ghostscript step, written out so it is runnable as printed --------

if (iccPath) {
  const absoluteIcc = path.resolve(iccPath);
  const defPs = write("PDFX_def.ps", pdfxDefPs(absoluteIcc, str("icc-condition") ?? "Custom", book.title));
  const stem = book.volumes.length > 1 ? `${bookSlug}-v1` : bookSlug;
  const command = ghostscriptCommand({
    pdf: path.join(outDir, `${stem}-interior.pdf`),
    out: path.join(outDir, `${stem}-interior-pdfx.pdf`),
    defPs,
    icc: absoluteIcc,
  });
  write(
    "gs-pdfx.sh",
    "#!/bin/sh\n" +
      "# Converts the interior to PDF/X-1a with CMYK separation and embedded fonts.\n" +
      "# Needs Ghostscript (brew install ghostscript / apt install ghostscript).\n" +
      "# Fernscout's own writer cannot do this — see docs/providers/photobook.md.\n" +
      "set -eu\n" +
      command.map((part) => (/[\s]/.test(part) ? `"${part}"` : part)).join(" \\\n  ") +
      "\n",
  );
  fs.chmodSync(path.join(outDir, "gs-pdfx.sh"), 0o755);
}

// ---- report ----------------------------------------------------------------

console.log(`\nWrote ${written.length} file(s) to ${displayPath(outDir)}/`);
for (const file of written) console.log(`  ${file}`);

if (book.warnings.length > 0) {
  console.log("\nWarnings:");
  // No stripping of the working directory: the paths in these are already
  // relative to the content root, because the plan they came from is.
  for (const w of book.warnings) console.log(`  ! [${w.code}] ${w.detail}`);
}

console.log("\nColour:");
for (const line of readinessReport(readiness)) console.log(`  ${line}`);
if (!iccPath) {
  console.log(
    "\n  Supply --icc <profile.icc> to embed an output intent. On macOS there is one at\n" +
      '  "/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc" for testing — but for\n' +
      "  a real order, use the profile the printer names (usually a FOGRA characterisation).",
  );
}
console.log("\nNothing was sent. Open the preview HTML before you order anything.");
