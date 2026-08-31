"use client";

import { createContext, useContext } from "react";
import type { Trip } from "@/lib/types";

/** What the header's trip switcher needs — deliberately not the full `Trip`:
 * `intro` is a whole paragraph per trip and has no business in the client
 * bundle on every page. */
export type TripSummary = Pick<
  Trip,
  "id" | "title" | "start" | "end" | "status" | "translations"
>;

const TripListContext = createContext<TripSummary[]>([]);

/**
 * Hands the (server-loaded) trip list down to client components — chiefly
 * `TripSwitcher` — without any of them touching `lib/trips.ts` themselves,
 * which is server-only (it reads `node:fs`) and would break the client
 * bundle if imported from a component rendered inside a client tree.
 */
export default function TripListProvider({
  trips,
  children,
}: {
  trips: TripSummary[];
  children: React.ReactNode;
}) {
  return <TripListContext.Provider value={trips}>{children}</TripListContext.Provider>;
}

/** Empty outside `TripListProvider` — every page is expected to be inside it
 * via the root layout, so this is a safety net, not a real code path. */
export function useTripList(): TripSummary[] {
  return useContext(TripListContext);
}
