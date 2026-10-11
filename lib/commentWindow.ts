/** Latest comments a day shows before "Show all"; matches the server's default page. */
export const COMMENTS_SHOWN = 3;

/**
 * Which of a day's comments to draw: the `limit` most recent unless expanded,
 * and whether a "Show all" is owed. `loaded` is how many are in hand, `total`
 * how many exist.
 */
export function commentWindow(
  loaded: number,
  total: number,
  limit: number,
  expanded: boolean,
): { shown: number; canExpand: boolean; canCollapse: boolean } {
  return {
    shown: expanded ? loaded : Math.min(limit, loaded),
    canExpand: !expanded && total > limit,
    canCollapse: expanded && total > limit,
  };
}
