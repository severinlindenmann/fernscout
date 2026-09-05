import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";
import { isEnabled } from "../capabilities";
import { listContacts } from "../contacts";
import { photobookCredits } from "../credits/pricing";
import { planBook, type Photobook } from "./plan";
import { buildBookSource, resolvePrintFile } from "./source";
import { BOOK_SIZES, SADDLE_STITCH, defaultSpec, portableRule, type BookSpec } from "./spec";
import { renderCover, renderVolume } from "./render";
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
  const size = BOOK_SIZES[options.size] ?? BOOK_SIZES["square-210"];
  const spec = defaultSpec(size);
  return { ...spec, pageCount: options.binding === "saddle" ? SADDLE_STITCH : portableRule() };
}

export function planFor(trip: string, options: BookOptions, followers?: string[]): Photobook {
  const source = buildBookSource(trip, {
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

/** Per volume, because each volume is a separate book with its own cover and
 * its own postage. */
export function priceOf(book: Photobook, options: BookOptions): number {
  return book.volumes.reduce((sum, v) => sum + photobookCredits(v.interiorPages, options.size), 0);
}

export function orderDir(owner: string, orderId: string): string {
  return path.join(contentRoot(), owner, "photobooks", orderId);
}

export function buildPhotobook(
  owner: string,
  orderId: string,
  trip: string,
  options: BookOptions,
  followers?: string[],
): { files: string[]; pages: number; volumes: number; missing: string[] } {
  // Built once, not through `planFor`: the document metadata below needs the
  // `BookSource` `planFor` discards, and building it twice would mean two
  // reads of the trip's entries for one order.
  const source = buildBookSource(trip, {
    excludePhotos: options.excludePhotos,
    includeNames: options.includeNames,
    followers,
  });
  const spec = specFor(options);
  const book = planBook(source, spec, options);
  const dir = orderDir(owner, orderId);
  fs.mkdirSync(dir, { recursive: true });

  // Matches `scripts/photobook.ts`'s `document`, minus `outputIntent` and
  // `pdfxVersion`: those need an ICC profile from a CLI flag with no browser
  // equivalent, so a book ordered from the button carries no PDF/X output
  // intent. Everything else — title, author, subject, creator — costs
  // nothing to set and is what makes this the same file a printer would see
  // from the CLI, not merely the same pages.
  const document = {
    title: book.title,
    author: source.travellers.join(" & "),
    subject: `${source.trip.start} to ${source.trip.end}`,
    creator: "Fernscout photobook",
  };

  const loadImage = (file: string) => new Uint8Array(fs.readFileSync(resolvePrintFile(file)));
  const files: string[] = [];
  const missing = new Set<string>();

  for (const volume of book.volumes) {
    const stem = book.volumes.length > 1 ? `v${volume.index}` : "book";
    const interior = renderVolume(volume, spec, { loadImage, document });
    const cover = renderCover(volume, spec, { loadImage, document });
    for (const file of [...interior.missing, ...cover.missing]) missing.add(file);
    fs.writeFileSync(path.join(dir, `${stem}-interior.pdf`), interior.pdf);
    fs.writeFileSync(path.join(dir, `${stem}-cover.pdf`), cover.pdf);
    files.push(`${stem}-interior.pdf`, `${stem}-cover.pdf`);
  }

  return {
    files,
    pages: book.volumes.reduce((n, v) => n + v.interiorPages, 0),
    volumes: book.volumes.length,
    missing: [...missing],
  };
}
