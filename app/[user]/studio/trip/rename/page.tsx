import { permanentRedirect } from "next/navigation";

/**
 * The old "Rename a trip" page — B2015. Since B2072 the rename is Edit a
 * trip's "Address" section; an old link or bookmark lands there, on the same
 * trip, scrolled to that section.
 */
export default async function StudioTripRenameRedirect({
  params,
  searchParams,
}: PageProps<"/[user]/studio/trip/rename">) {
  const { user } = await params;
  const { trip } = await searchParams;
  const query = typeof trip === "string" ? `trip=${encodeURIComponent(trip)}&section=address` : "section=address";
  permanentRedirect(`/${user}/studio/trip?${query}`);
}
