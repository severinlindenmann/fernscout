import type { Metadata } from "next";
import RedeemPage from "../../redeemPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * `/{user}/invite/guest/<token>` — the link that lets somebody into a journal.
 *
 * Journal-wide, and deliberately so: a guest is a guest of the journal and
 * never of one trip (B41). Approving somebody opens every trip marked
 * `visibility: guest`, at once and for as long as the approval lasts; a trip
 * that must be held back from them is `private`, and that is the only
 * mechanism there is.
 *
 * It is the same door B37 left standing — an owner-issued link to the request
 * form — at an address that says what it opens. Reaching it is not access:
 * whoever opens it proves their own address and waits for the owner, so
 * forwarding it round a family group chat widens who may *ask* and nothing
 * else.
 */
export default async function GuestInvitePage({
  params,
}: PageProps<"/[user]/invite/guest/[token]">) {
  const { user, token } = await params;
  return <RedeemPage username={user} token={token} kind="guest" />;
}
