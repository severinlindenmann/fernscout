/**
 * Concrete colours for the card SVG — B2538, item 3 of the coordinator's
 * follow-up.
 *
 * Every other SVG map on this site (`lib/map/style.ts`'s `mapStyle`) draws
 * `var(--map-…)` references and leans on the document's own cascade to
 * resolve them, which is exactly right for an SVG **inlined** into the
 * page. The card stopped being inlined: it is now served from
 * `/@<user>/card.svg` and consumed as `<img src>` (so a day paged to
 * client-side gets one too, not only a server-rendered permalink) — and an
 * `<img>`'s SVG is a *separate document*, with no access to the parent
 * page's stylesheet at all. `var(--map-land)` inside it resolves to
 * nothing.
 *
 * So the card bakes concrete hex instead, the same reasoning
 * `lib/map/printPalette.ts` already gives for the exact same problem (no
 * cascade to resolve against) — copied verbatim from `app/globals.css`'s
 * light `:root` and `:root[data-theme="dark"]` blocks. The image route
 * picks one of the two per request (`?theme=dark`); `components/map/MapCard.tsx`
 * asks for the reader's actual theme the same way `components/map/StreetMap.tsx`
 * already does.
 */
export type CardPalette = {
  land: string;
  sea: string;
  water: string;
  border: string;
  visited: string;
  road: string;
  roadCasing: string;
  selectedFill: string;
  clusterFill: string;
  plannedLeg: string;
  legChipFill: string;
  legChipBorder: string;
  legChipIcon: string;
  labelTown: string;
  labelStopHalo: string;
  accentNavy: string;
};

export const CARD_LIGHT: CardPalette = {
  land: "#f7f0de",
  sea: "#cdebf2",
  water: "#bfe6f0",
  border: "#b7a584",
  visited: "#ded1a8",
  road: "#ffffff",
  roadCasing: "#dccfb2",
  selectedFill: "#1e293b",
  clusterFill: "#1e293b",
  plannedLeg: "#1e293b",
  legChipFill: "#ffffff",
  legChipBorder: "#d8dee8",
  legChipIcon: "#1e293b",
  labelTown: "#5a6a80",
  labelStopHalo: "#f7f0de",
  accentNavy: "#3a4a63",
};

export const CARD_DARK: CardPalette = {
  land: "#1b2635",
  sea: "#0e2231",
  water: "#16324a",
  border: "#3d4d66",
  visited: "#29354a",
  road: "#2b3750",
  roadCasing: "#242e40",
  selectedFill: "#f2ecdd",
  clusterFill: "#f2ecdd",
  plannedLeg: "#f2ecdd",
  legChipFill: "#1f2736",
  legChipBorder: "#33405a",
  legChipIcon: "#f2ecdd",
  labelTown: "#c9c8c0",
  labelStopHalo: "#1b2635",
  accentNavy: "#aeb7c5",
};

export function cardPalette(scheme: "light" | "dark"): CardPalette {
  return scheme === "dark" ? CARD_DARK : CARD_LIGHT;
}
