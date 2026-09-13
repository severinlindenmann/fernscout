// Read-only twin of the approve route beside it — B1635. The approval page
// no longer receives the token as a path segment (so it never reaches an
// access log or a `Referer` header); the token instead lives in the page
// URL's fragment, which the browser keeps to itself, and this is what the
// page's own JS calls to turn that fragment into "approve N credits for
// journal X?" before the operator presses anything.
//
// **Grants nothing.** `approvableByToken` only reads; the credits move in
// `../route.ts`'s POST, which stays the one file (beside the Stripe webhook)
// that imports `grant` — this file does not, and does not belong in
// `GRANT_ALLOWED`.
import { formatChf } from "@/lib/credits/pricing";
import { approvableByToken } from "@/lib/payments";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/purchases/[id]/approve/preview">,
) {
  const { user, id } = await params;
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : "";

  const journal = getUser(user);
  if (!journal) return Response.json({ error: "unknown_payment" }, { status: 404 });

  // Same bucket and budget as the approve route: a preview and an approval
  // are the same guess-the-token attempt as far as this limit is concerned.
  const limit = rateLimitFor("payment-approve", clientIp(request), { max: 10, windowMs: 60 * 1000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  if (!token) return Response.json({ error: "bad_token" }, { status: 400 });

  const payment = await approvableByToken(user, id, token);
  if (!payment) return Response.json({ error: "unknown_payment" }, { status: 404 });

  return Response.json({ credits: payment.credits, amount: formatChf(payment.amountRappen) });
}
