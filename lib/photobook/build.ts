import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";
import { isEnabled } from "../capabilities";
import { listContacts } from "../contacts";
import { planBook, type Photobook } from "./plan";
import { buildBookSource, resolvePrintFile } from "./source";
import { BOOK_SIZES, defaultSpec, productUidFor, type BookSpec } from "./spec";
import { fetchCoverGeometry } from "./coverGeometry";
import { outputIntentFor, pdfxReadiness, readIcc } from "./pdfx";
import { renderBook, renderCover, renderVolume } from "./render";
import { printReadyImages } from "./images";
import type { BookOptions } from "./options";

/**
 * Options in, files out — the same three calls `scripts/photobook.ts` makes.
 *
 * Deliberately the same, and not a second pipeline: if the CLI and the button
 * produced different books, the preview HTML somebody approved would be
 * evidence about neither. This module is the CLI's middle, lifted out so a
 * route can call it, with the page count and the price as its only additions.
 *
 * ponytail: renders synchronously, in the request that pays. A 160-page book
 * is tens of seconds and hundreds of megabytes of JPEG copying. It is one
 * person pressing one button a few times a year, and a job queue is a
 * subsystem to run and recover. When that stops being true, the upgrade is to
 * respond first and mail when the files are on disk — the mail already carries
 * links rather than the PDF, so nothing else changes.
 */

export function specFor(options: BookOptions): BookSpec {
  const size = BOOK_SIZES[options.size] ?? BOOK_SIZES["square"];
  return defaultSpec(size, options.coverType);
}

export function planFor(trip: string, options: BookOptions, followers?: string[]): Photobook {
  const source = buildBookSource(trip, {
    locale: options.locale,
    excludePhotos: options.excludePhotos,
    includeNames: options.includeNames,
    followers,
  });
  return planBook(source, specFor(options), options);
}

/**
 * The journal's contacts, by name, for the "who came along" page.
 *
 * Here rather than in `buildBookSource` because contacts are rows and that
 * module is a filesystem reader; and `async` is the reason it cannot move —
 * the planner and the source are both synchronous and are better for it.
 *
 * **Names only.** `ContactRecord` carries an address and a postal address
 * beside the name, and neither has any business in a book that gets handed
 * around and eventually given away.
 *
 * Empty whenever there is nothing to say: contacts switched off, no database,
 * an error reaching it. The page is omitted rather than printed empty, and a
 * book is not worth failing over a list of names.
 */
export async function followerNames(owner: string): Promise<string[]> {
  if (!isEnabled("contacts", owner)) return [];
  try {
    const contacts = await listContacts(owner);
    return contacts
      .filter((c) => c.status === "active" && c.name)
      .map((c) => c.name as string)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    console.error(`[photobook] could not read contacts for ${owner}:`, error);
    return [];
  }
}

export function orderDir(owner: string, orderId: string): string {
  return path.join(contentRoot(), owner, "photobooks", orderId);
}

/**
 * Async since B885's follow-up, and only for one line: the cover geometry is
 * asked of Gelato before anything is drawn.
 *
 * A softcover spine is a formula and `computeCoverGeometry` gets it exactly
 * right. A hardcover's is a table Gelato maintains — 44, 60 and 72 pages give
 * 6, 6 and 9 mm — so no formula reproduces it, and the offline fallback is an
 * interpolation between measured rows. For a book somebody is about to pay to
 * have printed, an interpolation is not good enough: a spine 2 mm narrow
 * wraps the front image around onto the spine and nobody finds out until the
 * parcel arrives. So the real answer is fetched, and the fallback is what a
 * checkout with no API key draws with.
 */
/**
 * Replace each volume's computed cover geometry with Gelato's own, where it
 * will answer. Silent when it will not — no key, no network, a product it has
 * never heard of — because a book that cannot be printed today should still
 * be a book you can look at, and the fallback is close enough to look at.
 */
async function applyRealCoverGeometry(book: Photobook, options: BookOptions): Promise<void> {
  const productUid = productUidFor(options.size, options.coverType);
  if (!productUid) return;
  for (const volume of book.volumes) {
    const real = await fetchCoverGeometry(productUid, volume.interiorPages);
    if (!real) continue;
    volume.cover.geometry = real;
    volume.cover.widthMm = real.sheetWidthMm;
    volume.cover.heightMm = real.sheetHeightMm;
    volume.cover.spineWidthMm = real.spineWidthMm;
    volume.spineWidthMm = real.spineWidthMm;
  }
}

/**
 * The printing condition this instance's books declare, if the operator has
 * named one.
 *
 * **Deliberately not a profile shipped in this repository.** Under PDF/X-4 the
 * output intent describes where the file is going to be *printed*, not what
 * colour the content happens to be — Gelato names GRACoL 2006, another
 * printer names FOGRA51. Bundling one and defaulting to it would make every
 * book claim conformance against a condition its printer may not use, and a
 * false claim is worse than none: the claim is what stops anyone checking.
 *
 * So the operator drops the file their printer names beside the instance and
 * sets `PRINT_ICC_PROFILE` to it. With nothing set, a book is an ordinary PDF
 * with embedded fonts — which is most of the way there — and says so in its
 * readiness report rather than pretending.
 *
 * Read on every build rather than cached: it is one small file, and an
 * operator who has just installed a profile should not have to restart.
 */
function printOutputIntent(): ReturnType<typeof outputIntentFor> | undefined {
  const at = process.env.PRINT_ICC_PROFILE?.trim();
  if (!at) return undefined;
  try {
    return outputIntentFor(readIcc(new Uint8Array(fs.readFileSync(at))));
  } catch (err) {
    // Never fatal. A book that prints without an intent is worth far more
    // than an order that fails because a profile path has a typo in it.
    console.warn(`photobook: ignoring PRINT_ICC_PROFILE (${at}):`, (err as Error).message);
    return undefined;
  }
}

export async function buildPhotobook(
  owner: string,
  orderId: string,
  trip: string,
  options: BookOptions,
  followers?: string[],
): Promise<{ files: string[]; pages: number; volumes: number; missing: string[] }> {
  // Built once, not through `planFor`: the document metadata below needs the
  // `BookSource` `planFor` discards, and building it twice would mean two
  // reads of the trip's entries for one order.
  const source = buildBookSource(trip, {
    locale: options.locale,
    excludePhotos: options.excludePhotos,
    includeNames: options.includeNames,
    followers,
  });
  const spec = specFor(options);
  const book = planBook(source, spec, options);
  await applyRealCoverGeometry(book, options);
  const dir = orderDir(owner, orderId);
  fs.mkdirSync(dir, { recursive: true });

  // Matches `scripts/photobook.ts`'s `document`, output intent included —
  // that used to be the one thing the CLI could do and the button could not,
  // so a book ordered from the page could never claim PDF/X-4 however good
  // the file was.
  const intent = printOutputIntent();
  // The version is claimed only when the audit says every requirement is met,
  // which is the one place that flag may come from — a file claiming PDF/X-4
  // that a preflight then fails is worse than a file claiming nothing.
  const readiness = pdfxReadiness({
    outputIntent: Boolean(intent),
    fontsEmbedded: true,
    cmykContent: false,
    transparency: false,
  });
  const document = {
    title: book.title,
    author: source.travellers.join(" & "),
    subject: `${source.trip.start} to ${source.trip.end}`,
    creator: "Fernscout photobook",
    ...(intent ? { outputIntent: intent } : {}),
    ...(readiness.version ? { pdfxVersion: readiness.version } : {}),
  };

  const fromDisk = (file: string) => new Uint8Array(fs.readFileSync(resolvePrintFile(file)));
  // B1172. Each photograph re-encoded to the size it is actually printed at,
  // once, before either renderer asks for it — the cover and the interior
  // share the map, so a photograph on both is converted once and embedded
  // twice. `renderVolume` is synchronous and `sharp` is not, which is why this
  // is a pass rather than a hook inside `loadAll`.
  const printReady = await printReadyImages(book, spec, fromDisk);
  const loadImage = (file: string) => printReady.get(file) ?? fromDisk(file);
  const files: string[] = [];
  const missing = new Set<string>();

  for (const volume of book.volumes) {
    const stem = book.volumes.length > 1 ? `v${volume.index}` : "book";
    const interior = renderVolume(volume, spec, { loadImage, document });
    const cover = renderCover(volume, spec, { loadImage, document });
    // B1180. The whole book in one file, cover first — the shape Gelato's own
    // template has and its uploader demands. Written beside the two halves
    // rather than instead of them: the halves are what the API submits and
    // what somebody takes to a different printer, and this is what a person
    // uploads to Gelato by hand.
    const whole = renderBook(volume, spec, { loadImage, document });
    for (const file of [...interior.missing, ...cover.missing]) missing.add(file);
    fs.writeFileSync(path.join(dir, `${stem}-interior.pdf`), interior.pdf);
    fs.writeFileSync(path.join(dir, `${stem}-cover.pdf`), cover.pdf);
    fs.writeFileSync(path.join(dir, `${stem}.pdf`), whole.pdf);
    files.push(`${stem}-interior.pdf`, `${stem}-cover.pdf`, `${stem}.pdf`);
  }

  return {
    files,
    pages: book.volumes.reduce((n, v) => n + v.interiorPages, 0),
    volumes: book.volumes.length,
    missing: [...missing],
  };
}
