import type { Metadata } from "next";
import RedeemPage from "../../redeemPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * `/{user}/invite/buddy/<token>` — the link that puts somebody on a trip.
 *
 * **The stronger of the two, and the kind is in the path so a recipient can
 * tell.** Being on a trip means writing to the whole of it and being able to
 * hold an agent token scoped to it, and — because one approval decides about a
 * person rather than about a permission — reading the journal's `guest` trips
 * as well. It is for the two people you actually travelled with, not for a
 * group chat.
 *
 * What it still is not is a grant. Following it writes a request to join,
 * exactly as the guest link writes a request to be let in, and the owner
 * approves by hand. A link that granted write access on a click alone would be
 * a link that granted write access to whoever it was forwarded to.
 */
export default async function BuddyInvitePage({
  params,
}: PageProps<"/[user]/invite/buddy/[token]">) {
  const { user, token } = await params;
  return <RedeemPage username={user} token={token} kind="buddy" />;
}
