import { notFound } from "next/navigation";
import TripGate from "@/components/TripGate";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { awaitingApproval, guestBlockedByPrivateTrip, mayReadTrip, signedInAs } from "@/lib/tripGate";
import { getCurrentTrip } from "@/lib/trips";
import { getUser } from "@/lib/users";
import { whatsappSignInOffered } from "@paid/whatsapp/lib/whatsapp/settings";

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
    // Four reads about the reader in front of the gate, none depending on
    // another — asked together rather than in the order the props list them.
    const [who, whatsappSignIn, guestBlockedByPrivate, waiting] = await Promise.all([
      signedInAs(username),
      whatsappSignInOffered(username),
      guestBlockedByPrivateTrip(current),
      awaitingApproval(username),
    ]);
    return (
      <TripGate
        username={username}
        journalTitle={getUser(username)?.title ?? username}
        ownerName={getUser(username)?.owner?.nickname?.trim() || getUser(username)?.title || username}
        signedInAs={who}
        canSignIn={isEnabled("auth", username)}
        codeMinutes={CODE_TTL_MINUTES}
        whatsappSignIn={whatsappSignIn}
        guestBlockedByPrivate={guestBlockedByPrivate}
        waiting={waiting}
      />
    );
  }
  return children;
}
