import type { TripAccent } from "@/lib/types";

/**
 * Concrete colours for a printed route map — B2431 (Phase 4,
 * docs/plans/map-redesign.md §3).
 *
 * Every other SVG map on this site draws through `lib/map/style.ts`'s
 * `var(--map-…)` tokens, resolved by the browser against `app/globals.css`'s
 * cascade. A print context has no cascade to resolve them against — a PDF
 * renderer, a static image export, or `renderToStaticMarkup` with no
 * stylesheet at all — so `components/map/PrintRouteMap.tsx` cannot draw with
 * `mapStyle` and needs concrete values instead.
 *
 * These are copied verbatim from `app/globals.css`'s light `:root` block
 * (the theme a printed page has ever asked for; there is no "print in dark
 * mode"). `test/print-route-map.test.tsx` holds every other file this
 * component reaches to no hex literal outside this one, so a colour that
 * drifts from the light theme is caught the same way `test/map-tokens.test.ts`
 * catches a drift in the token values themselves.
 */
export type PrintPalette = {
  land: string;
  sea: string;
  water: string;
  border: string;
  borderInternal: string;
  stopFill: string;
  stopRing: string;
  stopNumber: string;
  routeCasing: string;
  labelStop: string;
  labelStopHalo: string;
  labelTown: string;
  ink: string;
};

/** `app/globals.css`'s light `:root` block, the source of every value here. */
export const PRINT_PALETTE: PrintPalette = {
  land: "#f7f0de",
  sea: "#cdebf2",
  water: "#bfe6f0",
  border: "#b7a584",
  borderInternal: "#dccfb2",
  stopFill: "#ffffff",
  stopRing: "#1e293b",
  stopNumber: "#1e293b",
  routeCasing: "#ffffff",
  labelStop: "#1e293b",
  labelStopHalo: "#f7f0de",
  labelTown: "#5a6a80",
  // The scale bar and north arrow: not one of `mapStyle`'s own tokens (no
  // map draws either today), so this names the label ink directly rather
  // than reusing `labelStop` for a role that happens to want the same value.
  ink: "#1e293b",
};

/** The light `--map-accent-*` steps (Q2, docs/plans/map-redesign.md §7) —
 * the same values `lib/map/style.ts`'s `ACCENT_VAR` points at, copied
 * concrete for the same reason as `PRINT_PALETTE` above. */
const PRINT_ACCENT: Record<TripAccent, string> = {
  sky: "#3795ac",
  yellow: "#b48208",
  green: "#15803d",
  coral: "#c2334a",
  navy: "#3a4a63",
};

export function printAccent(accent: TripAccent): string {
  return PRINT_ACCENT[accent];
}
