import { getEntryBySlug } from "@/lib/entries";
import { mayReadTrip } from "@/lib/tripGate";
import { currentTripRef, getTrip } from "@/lib/trips";

/**
 * A day's markdown source.
 *
 * Reached as `/<user>/day/<slug>.md` through a rewrite — the convention at
 * llmstxt.org is to serve a clean markdown twin of each page, and here that is
 * nearly free because the content already *is* markdown. Nothing is converted,
 * so nothing can drift between what a reader sees and what an agent reads.
 *
 * Gated exactly like the HTML page. A markdown twin that ignored visibility
 * would be the easiest way to read a private trip.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/md/[user]/[slug]">) {
  const { user, slug } = await params;

  const ref = currentTripRef(user);
  const trip = ref ? getTrip(ref) : undefined;
  if (!ref || !trip) return new Response("Not found", { status: 404 });
  if (!(await mayReadTrip(trip))) return new Response("Not found", { status: 404 });

  const entry = getEntryBySlug(ref, slug);
  if (!entry) return new Response("Not found", { status: 404 });

  const body = [
    "---",
    `title: ${JSON.stringify(entry.title)}`,
    `date: ${JSON.stringify(entry.date)}`,
    ...(entry.time ? [`time: ${JSON.stringify(entry.time)}`] : []),
    `location: ${JSON.stringify(entry.location)}`,
    `country: ${JSON.stringify(entry.country)}`,
    ...(Number.isFinite(entry.lat) ? [`lat: ${entry.lat}`] : []),
    ...(Number.isFinite(entry.lng) ? [`lng: ${entry.lng}`] : []),
    ...(entry.gallery.length ? [`photos: ${entry.gallery.length}`] : []),
    "---",
    "",
    entry.content,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "public, max-age=300",
    },
  });
}
