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
  /**
   * Whether this reader may put a draft on the site — B327.
   *
   * The one piece of viewer state on a context otherwise derived entirely from
   * the trip, and it is here because the alternative was threading a boolean
   * through `TripStory` → `StoryPager` → the day card to reach `DraftNotice`,
   * which is four components that have no other reason to know who is reading.
   *
   * It exists because drafts stopped being the owner's alone. Somebody on the
   * trip now sees them and cannot publish them, so the banner has two things
   * to say and has to pick — "only you can see this, tell your agent to
   * publish it" is false to a buddy in both halves.
   *
   * **Defaults to false**, so a page that forgets to pass it shows the
   * narrower copy rather than telling a buddy the day is theirs to publish.
   */
  canPublish: boolean;
};

const TripContext = createContext<Ctx | null>(null);

export default function TripProvider({
  trip,
  isCurrent,
  canPublish = false,
  children,
}: {
  trip: Trip;
  isCurrent: boolean;
  /** See `Ctx.canPublish`. Omitted where the page shows no drafts. */
  canPublish?: boolean;
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
      canPublish,
      base,
      userBase,
      // "/" is the story page, whose URL is the base itself — so it must not
      // pick up a trailing slash.
      href: (path: string) => (path === "/" ? base || "/" : `${base}${path}`),
      /** For pages that belong to the user rather than to one trip. */
      userHref: (path: string) => (path === "/" ? userBase : `${userBase}${path}`),
    };
  }, [trip, isCurrent, canPublish]);

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>;
}

/** Null outside a trip page — /trips itself has no single trip. */
export function useTrip(): Ctx | null {
  return useContext(TripContext);
}
