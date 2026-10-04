"use client";

import { usePathname, useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { studioUp, type StudioUp } from "@/lib/studio/studioUp";

/**
 * The studio's one reading of "where is up" — B2853. Pathname and query come
 * from the address, so the header and the bottom bar (which calls this too)
 * can never name different places. `tripId` is only for a page whose address
 * lacks it and whose server render already knows it (`day/edit?slug=`).
 */
export function useStudioUp(username: string, tripId?: string): StudioUp {
  const pathname = usePathname() ?? "";
  const query = useSearchParams();
  return studioUp(username, pathname, query ?? new URLSearchParams(), { tripId });
}

/** `PageHeader` with its back set to the studio page's real parent; none on the hub. */
export default function StudioHeader({ username, back, tripId }: { username: string; back: boolean; tripId?: string }) {
  const up = useStudioUp(username, tripId);
  return <PageHeader backTo={back ? up : undefined} />;
}
