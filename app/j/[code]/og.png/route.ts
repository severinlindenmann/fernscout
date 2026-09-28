import { headers } from "next/headers";
import { isEnabled } from "@/lib/capabilities";
import { resolveJoinCode } from "@/lib/contacts/welcome";
import { inviteCard, inviteSubject } from "@/lib/invitePreview";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

const LOOKUPS = { max: 30, windowMs: 15 * 60 * 1000 };

/** /j/<code>/og.png — the invitation's preview card (B2502). The same answer
 * as the page: the journal's title for a live code, a neutral card for any
 * other, rate-limited like the page so it is no cheaper a way to test codes. */
export async function GET(_request: Request, { params }: RouteContext<"/j/[code]/og.png">): Promise<Response> {
  const { code } = await params;
  const allowed = rateLimitFor("join-card", clientIp(await headers()), LOOKUPS).ok;
  const invite = allowed && isEnabled("contacts") ? await resolveJoinCode(code) : null;
  const user = invite && isEnabled("contacts", invite.owner) ? getUser(invite.owner) : null;
  const tripMissing = invite?.kind === "buddy" && !(invite.tripId && getTrip(tripRef(invite.owner, invite.tripId)));
  return inviteCard(invite && !tripMissing ? inviteSubject(user, invite.locale) : null);
}
