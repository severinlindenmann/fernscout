import { permanentRedirect } from "next/navigation";

import { journalPath } from "@/lib/journalPath";
/**
 * The old "Rename a trip" page — B2015. Since B2072 the rename is Edit a
 * trip's "Address" section; an old link or bookmark lands there, on the same
 * trip, scrolled to that section.
 */
export default async function StudioTripRenameRedirect({
  params,
  searchParams,
}: PageProps<"/at/[user]/studio/trip/rename">) {
  const { user } = await params;
  const { trip } = await searchParams;
  const query = typeof trip === "string" ? `trip=${encodeURIComponent(trip)}&section=address` : "section=address";
  permanentRedirect(`${journalPath(user)}/studio/trip?${query}`);
}
