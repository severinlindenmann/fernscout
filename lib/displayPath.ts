import path from "node:path";

/**
 * A generated file's path, as it should be printed for a person.
 *
 * The generator scripts used to print `path.relative(process.cwd(), file)`
 * unconditionally, which is a string somebody can paste only while the content
 * root and the working directory are the same place. On a deployed instance
 * they are not: the content root is under `DATA_DIR` and the working directory
 * is the code checkout, so the relative path between them is a ladder of `..`
 * that is true and useless — and, worse, reads as though the file had landed
 * beside the code (B219).
 *
 * So: relative when the file really is under `from`, absolute otherwise.
 * Nothing is ever printed that would not find the file if it were pasted.
 */
export function displayPath(file: string, from: string = process.cwd()): string {
  const absolute = path.resolve(file);
  const relative = path.relative(path.resolve(from), absolute);
  if (relative === "") return absolute;
  if (relative.startsWith("..") || path.isAbsolute(relative)) return absolute;
  return relative;
}
