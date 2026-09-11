/**
 * Which of a built book's files a reader is shown — B1366.
 *
 * `build.ts` writes three files per volume: the interior half and the cover
 * half Gelato prints from, and the whole book (`book.pdf`, or `v1.pdf`/
 * `v2.pdf` for more than one volume) meant for a person to look at or upload
 * elsewhere by hand. Nobody reading the order page wants the print halves —
 * they are Gelato's inputs, not anybody's book — so this keeps only the
 * whole-book file per volume.
 *
 * The suffix test is anchored (`-interior.pdf` / `-cover.pdf` at the very
 * end) rather than matching the single-volume literal `book-interior.pdf`:
 * a multi-volume book's halves are named `v1-interior.pdf`, `v1-cover.pdf`,
 * and a literal match would let those straight through.
 */
export function visibleBookFiles(files: string[]): string[] {
  return files.filter((file) => !/-(?:interior|cover)\.pdf$/.test(file));
}
