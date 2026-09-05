import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";
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

export function planFor(trip: string, options: BookOptions): Photobook {
  const source = buildBookSource(trip, {
    excludePhotos: options.excludePhotos,
    includeNames: options.includeNames,
  });
  return planBook(source, specFor(options), options);
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
): { files: string[]; pages: number; volumes: number } {
  const book = planFor(trip, options);
  const spec = book.spec;
  const dir = orderDir(owner, orderId);
  fs.mkdirSync(dir, { recursive: true });

  const loadImage = (file: string) => new Uint8Array(fs.readFileSync(resolvePrintFile(file)));
  const files: string[] = [];

  for (const volume of book.volumes) {
    const stem = book.volumes.length > 1 ? `v${volume.index}` : "book";
    const interior = renderVolume(volume, spec, { loadImage });
    const cover = renderCover(volume, spec, { loadImage });
    fs.writeFileSync(path.join(dir, `${stem}-interior.pdf`), interior.pdf);
    fs.writeFileSync(path.join(dir, `${stem}-cover.pdf`), cover.pdf);
    files.push(`${stem}-interior.pdf`, `${stem}-cover.pdf`);
  }

  return {
    files,
    pages: book.volumes.reduce((n, v) => n + v.interiorPages, 0),
    volumes: book.volumes.length,
  };
}
