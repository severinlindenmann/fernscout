import { markWelcomeOpened, resolveWelcomeCode } from "@/lib/contacts/welcome";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const LIMIT = { max: 30, windowMs: 15 * 60 * 1000 };

/**
 * The first open of a welcome link — B2292. Stamps `welcome_opened_at` and
 * nothing else; always 204, so it answers nothing about the code.
 */
export async function POST(request: Request, { params }: RouteContext<"/w/[code]/opened">) {
  const { code } = await params;
  if (rateLimitFor("welcome-lookup", clientIp(request), LIMIT).ok) {
    const found = await resolveWelcomeCode(code);
    if (found) await markWelcomeOpened(found.owner, found.contact.id);
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
