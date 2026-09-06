/**
 * Cuts one or more spreads out of the full preview HTML — the composer's
 * level-2 drill-in (B534).
 *
 * The preview is a debounced server round-trip (see `PhotobookPageContent`'s
 * own note on that); level 2 must not turn a drill-in into a second one, so
 * this works entirely off the HTML the level-1 preview already fetched.
 * `lib/photobook/preview.ts` stamps every drillable `<figure>` with
 * `data-kind` and, where it has one, `data-date` — the same `BookPage.date`
 * B534 added to the "photos" variant for exactly this. Keeping the `<head>`
 * (all the layout CSS) means the slice renders identically to the full
 * preview, just cropped to fewer spreads.
 */
export function extractSpreads(
  fullHtml: string,
  matches: (dataset: DOMStringMap) => boolean,
): string | null {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(fullHtml, "text/html");
  const spreads = new Set<Element>();
  for (const fig of doc.querySelectorAll<HTMLElement>("figure[data-kind]")) {
    if (!matches(fig.dataset)) continue;
    const spread = fig.closest(".spread");
    if (spread) spreads.add(spread);
  }
  if (spreads.size === 0) return null;
  const body = [...spreads].map((el) => el.outerHTML).join("");
  // `class="bare"` because the composer is the only caller: the document it
  // sliced was rendered bare (B548) and the level-2 frame wants the same
  // horizontal strip, with none of the technician's chrome around it.
  return `<!doctype html><html><head>${doc.head.innerHTML}</head>` +
    `<body class="bare" data-view="spreads"><div class="spreads">${body}</div></body></html>`;
}
