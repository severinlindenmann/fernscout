import { headers } from "next/headers";
import { isEnabled } from "@/lib/capabilities";
import { resolveWelcomeCode } from "@/lib/contacts/welcome";
import { inviteCard, inviteSubject } from "@/lib/invitePreview";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";

const LOOKUPS = { max: 30, windowMs: 15 * 60 * 1000 };

/** /w/<code>/og.png — the welcome link's preview card (B2502). The journal's
 * title for a live code, never the person's own name; neutral otherwise. */
export async function GET(_request: Request, { params }: RouteContext<"/w/[code]/og.png">): Promise<Response> {
  const { code } = await params;
  const allowed = rateLimitFor("welcome-card", clientIp(await headers()), LOOKUPS).ok;
  const found = allowed && isEnabled("contacts") ? await resolveWelcomeCode(code) : null;
  const user = found && isEnabled("contacts", found.owner) ? getUser(found.owner) : null;
  return inviteCard(found ? inviteSubject(user) : null);
}
