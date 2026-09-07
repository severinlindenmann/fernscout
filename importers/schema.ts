/**
 * What every importer is, whatever it reads — MIT, like the rest of this
 * folder.
 *
 * An importer turns one file somebody exported from somewhere else into rows
 * this software understands. That is the whole job: no network, no disk, no
 * journal, no knowledge of what a trip is.
 *
 * **The kind of data is the subfolder**, and each kind owns its own row type:
 *
 * | `gps/` | positions — `Fix`, and `npm run gps -- import` reads them |
 *
 * A second kind is a new folder with its own `types.ts` and its own consumer:
 * a bank export into a trip's costs would be `costs/`, with a `Cost` row that
 * has nothing to do with a coordinate. That separation is the point of this
 * file being one generic parameter and nothing else — there is no plugin
 * interface here to implement, no base class to extend, and no registry to
 * register with. A folder, and the rows it produces.
 */

export type Importer<Row> = {
  /** Stable, lowercase, dashes. Unique within its kind — `--format <id>` is
   * how somebody overrides detection, and it outlives the import. */
  id: string;
  /** What a person calls this export, for the CLI's listing. */
  label: string;
  /**
   * Does this file look like yours?
   *
   * Given the first 64 kB and the file's name. Be strict: a loose `detect`
   * that answers yes to somebody else's export is worse than one that answers
   * no to its own, because `--format <id>` is always available and a wrong
   * parse is silent.
   */
  detect(head: string, filename: string): boolean;
  /**
   * Every row in the file, in any order — the caller sorts and de-duplicates.
   *
   * Skip what does not parse rather than throwing: these exports are large,
   * changed by their vendors without notice, and one unreadable segment must
   * not cost the other ten months. Throw only when the file is not yours at
   * all.
   *
   * ponytail: takes the whole file as a string, so an export much past a
   * gigabyte will not fit. Make it an async iterable if anyone ever brings
   * one.
   */
  parse(text: string): Row[];
};

/** An ISO instant to epoch milliseconds, or undefined. Offsets and `Z` both.
 * Here rather than in `gps/` because everything with rows in it has dates. */
export function parseInstant(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}
