import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TripPasswordForm from "@/components/TripPasswordForm";
import { isIndexable } from "@/lib/access";
import { mayReadTrip, tripLockReason } from "@/lib/tripGate";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

/**
 * Rendered per request, not prerendered.
 *
 * Everything under `/[user]` reads cookies — `listableTrips` in the user
 * layout, and the password gate below — and a page that answers differently
 * depending on who is asking cannot be a build artefact. The pages in this
 * subtree declared `generateStaticParams`, so Next marked them SSG, prerender
 * bailed with `DYNAMIC_SERVER_USAGE`, and **every `/[user]/trips/<id>` URL
 * returned 500 in production** while working perfectly in `next dev` — which
 * is exactly the shape of bug that reaches a reader before it reaches anyone
 * else. The sibling routes under `/[user]/(trip)` were already dynamic for the
 * same reason; this makes the two agree.
 *
 * Verified: at HEAD, `next build && next start` then GET
 * `/example/trips/example-trip` → 500. With this line → 307 to `/example`, and
 * an unknown trip renders the not-found page instead of an error.
 */
export const dynamic = "force-dynamic";

/** See app/(current)/layout.tsx — the same gate, for trips at /trips/<id>. */
export async function generateMetadata({
  params,
}: LayoutProps<"/[user]/trips/[trip]">): Promise<Metadata> {
  const { user, trip: id } = await params;
  const trip = getTrip(tripRef(user, id));
  if (trip && !isIndexable(trip)) {
    return { robots: { index: false, follow: false } };
  }
  return {};
}

export default async function TripLayout({
  children,
  params,
}: LayoutProps<"/[user]/trips/[trip]">) {
  const { user, trip: id } = await params;
  const trip = getTrip(tripRef(user, id));
  if (!trip) notFound();
  if (await mayReadTrip(trip)) return children;
  return (
    <TripPasswordForm
      /* The qualified ref, not the bare id: /api/trip-access resolves it with
         getTrip(), which needs "<user>/<id>". A bare id resolved to nothing,
         so the endpoint answered "wrong-password" to the *correct* password
         and no password-protected trip outside the current one could ever be
         opened. The sibling layout has always passed `current.ref`. */
      tripId={trip.ref}
      tripTitle={trip.title}
      username={user}
      journalTitle={getUser(user)?.title ?? user}
      reason={await tripLockReason(trip)}
    />
  );
}
