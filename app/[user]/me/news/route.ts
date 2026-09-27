import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { journalReader } from "@/lib/contacts/session";
import { clearNewsConsent } from "@/lib/newsConsent";

export const dynamic = "force-dynamic";

/**
 * `POST /<user>/me/news` — "Stop news from Fernscout" on the reader's own page
 * (B2453). Withdraws the instance-wide consent the join form asked for, for
 * the address this browser's session proves and nothing else: no body is
 * read, so no caller can name somebody else's address. Cookie-only, like the
 * rest of /me.
 */
export async function POST(request: Request, { params }: RouteContext<"/[user]/me/news">) {
  if (foreignOrigin(request)) return Response.json(FOREIGN_ORIGIN_REFUSAL, { status: 403 });
  const { user } = await params;
  const reader = await journalReader(user);
  if (!reader.email || !reader.email.includes("@")) {
    return Response.json({ error: "not_signed_in" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  await clearNewsConsent(reader.email);
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
