import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import TripGate from "@/components/TripGate";
import { isIndexable } from "@/lib/access";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { PATH_HEADER } from "@/lib/requestKeys";
import { awaitingApproval, guestBlockedByPrivateTrip, mayReadTrip, signedInAs } from "@/lib/tripGate";
import { getTrip, tripRef } from "@/lib/trips";
import { resolveRenamedTripId } from "@/lib/tripRename";
import { getUser } from "@/lib/users";
import { whatsappSignInOffered } from "@paid/whatsapp/lib/whatsapp/settings";

/**
 * Rendered per request, not prerendered.
 *
 * Everything under `/[user]` reads cookies — `listableTrips` in the user
 * layout, and the gate below — and a page that answers differently
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

/**
 * `noindex` for a trip that is not indexable, and nothing else.
 *
 * The gate itself is below. Its sibling is `app/[user]/(trip)/layout.tsx` —
 * the same gate, over the pages that render the *current* trip at the bare
 * `/<user>` URLs. The two have to be kept in step, so read one before
 * changing the other.
 */
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

/**
 * A trip `id` this journal renamed away — B2015. Every route under this
 * layout answers here, so this is the one door that has to know the old
 * address still works: a permanent redirect to the same path, with the new
 * id in place of the old one. `PATH_HEADER` (set by `proxy.ts`) carries the
 * full incoming path, since a layout's own `params` name only `user` and
 * `trip` and this may sit under `/gallery`, `/costs`, `/day/<slug>`, and so
 * on.
 */
async function renamedTripRedirect(user: string, id: string): Promise<never | void> {
  const resolved = resolveRenamedTripId(user, id);
  if (resolved === id || !getTrip(tripRef(user, resolved))) return;
  const pathname = (await headers()).get(PATH_HEADER) ?? `/${user}/trips/${id}`;
  const segments = pathname.split("/");
  // `["", user, "trips", id, ...rest]` — the id is always the fourth segment
  // under this layout's own path shape.
  if (segments[3] === id) segments[3] = resolved;
  permanentRedirect(segments.join("/"));
}

export default async function TripLayout({
  children,
  params,
}: LayoutProps<"/[user]/trips/[trip]">) {
  const { user, trip: id } = await params;
  const trip = getTrip(tripRef(user, id));
  if (!trip) {
    await renamedTripRedirect(user, id);
    notFound();
  }
  if (await mayReadTrip(trip)) return children;
  return (
    <TripGate
      username={user}
      journalTitle={getUser(user)?.title ?? user}
      signedInAs={await signedInAs(user)}
      canSignIn={isEnabled("auth", user)}
      canAsk={isEnabled("contacts", user)}
      codeMinutes={CODE_TTL_MINUTES}
      whatsappSignIn={await whatsappSignInOffered(user)}
      guestBlockedByPrivate={await guestBlockedByPrivateTrip(trip)}
      waiting={await awaitingApproval(user)}
    />
  );
}
