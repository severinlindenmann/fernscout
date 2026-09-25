// A pure helper for the journal's set editor (B2022) — the walking order IS
// array order (`journalFigures`'s own `{mode: "set", figures: [ids]}`), so
// "move this one up" is just swapping two neighbours. No fs, no fetch: the
// same reason `lib/figures/creator.ts` stays pure, so `FigureLibrary` and a
// unit test can both import it with nothing running.
export function moveFigureInSet(ids: readonly string[], id: string, direction: "up" | "down"): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return [...ids];
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
