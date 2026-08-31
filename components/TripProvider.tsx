"use client";

import { createContext, useContext, useMemo } from "react";
import type { Trip } from "@/lib/types";

type Ctx = {
  trip: Trip;
  /** True when this trip is shown at the bare URLs. */
  isCurrent: boolean;
  /** "/<username>" for the current trip, "/<username>/trips/<id>" otherwise. */
  base: string;
  /** "/<username>" — the owner's root, regardless of which trip is in view. */
  userBase: string;
  /** Prefixes an in-site path with that base. */
  href: (path: string) => string;
  /** Prefixes a user-level path (/trips, /search) with the owner's root. */
  userHref: (path: string) => string;
};

const TripContext = createContext<Ctx | null>(null);

export default function TripProvider({
  trip,
  isCurrent,
  children,
}: {
  trip: Trip;
  isCurrent: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo<Ctx>(() => {
    // Every URL carries the owner now, so the base starts at the user and the
    // trip segment is added only for a trip that is not the current one.
    // Without this, every in-site link points at a path that no longer exists.
    const userBase = `/${trip.username}`;
    const base = isCurrent ? userBase : `${userBase}/trips/${trip.id}`;
    return {
      trip,
      isCurrent,
      base,
      userBase,
      // "/" is the story page, whose URL is the base itself — so it must not
      // pick up a trailing slash.
      href: (path: string) => (path === "/" ? base || "/" : `${base}${path}`),
      /** For pages that belong to the user rather than to one trip. */
      userHref: (path: string) => (path === "/" ? userBase : `${userBase}${path}`),
    };
  }, [trip, isCurrent]);

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>;
}

/** Null outside a trip page — /trips itself has no single trip. */
export function useTrip(): Ctx | null {
  return useContext(TripContext);
}
