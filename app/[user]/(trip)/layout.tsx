import { notFound } from "next/navigation";
import TripGate from "@/components/TripGate";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { mayReadTrip, signedInAs } from "@/lib/tripGate";
import { getCurrentTrip } from "@/lib/trips";
import { getUser } from "@/lib/users";

/**
 * The gate, scoped to the pages that actually show the current trip.
 *
 * It used to live in the user layout, which meant one closed trip also hid
 * that person's *other* trips, their search page, and the invite and contact
 * pages a reader needs in order to ask for access at all. Gating a whole
 * journal because one trip is private is the wrong blast radius.
 *
 * A route group keeps the URLs unchanged: `/(trip)/costs` is still
 * `/<user>/costs`.
 */
export default async function TripPagesLayout({
  children,
  params,
}: LayoutProps<"/[user]">) {
  const { user: username } = await params;
  if (!getUser(username)) notFound();

  const current = getCurrentTrip(username);
  if (current && !(await mayReadTrip(current))) {
    return (
      <TripGate
        tripTitle={current.title}
        username={username}
        journalTitle={getUser(username)?.title ?? username}
        signedInAs={await signedInAs(username)}
        canSignIn={isEnabled("auth", username)}
        codeMinutes={CODE_TTL_MINUTES}
      />
    );
  }
  return children;
}
