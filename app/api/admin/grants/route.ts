import { loadServerConfig } from "@/lib/config";
import { isInstanceAdmin } from "@/lib/adminGate";
import { sendTransactional } from "@/lib/mail";
import { renderMail } from "@/lib/mail/template";
import { createAdminGrant } from "@/lib/payments";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The operator asks for credits to be added to a journal — B746.
 *
 * **This grants nothing, and that is the point.** `lib/credits.ts`'s property
 * 1 stands: nothing reachable over HTTP raises a balance. What this does is
 * file a zero-franc transaction and mail the operator the same single-use
 * approval link an ordinary purchase mints; opening that link is what grants,
 * through `app/api/v1/[user]/payments/[id]/approve/route.ts`, which remains
 * the only file in the codebase that imports `grant`.
 *
 * So somebody holding an admin cookie can cause an email to arrive in the
 * operator's mailbox and nothing else — the same property that makes deleting
 * a journal safe (B38), for the same reason.
 *
 * Outside `/api/v1/` deliberately: it takes the admin's cookie only and there
 * is no bearer-token path to it, the same shape the postcard send route has.
 */
export async function POST(request: Request) {
  if (!(await isInstanceAdmin())) {
    // The same answer an unknown route gives. As far as anybody who is not the
    // operator is concerned, there is no instance admin here.
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const limit = rateLimitFor("admin-grant", clientIp(request), { max: 20, windowMs: 60 * 1000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.user === "string" ? body.user : "";
  const credits = typeof body.credits === "number" ? body.credits : NaN;

  if (!getUser(username)) return Response.json({ error: "unknown_journal" }, { status: 404 });
  if (!Number.isInteger(credits) || credits <= 0 || credits > 10_000) {
    return Response.json(
      { error: "bad_credits", message: "credits must be a whole number between 1 and 10000." },
      { status: 400 },
    );
  }

  const operator = loadServerConfig().site.operatorEmail;
  if (!operator) {
    // Nothing to mail the link to, so nothing could ever approve it. Say so
    // rather than filing a request nobody will see.
    return Response.json(
      { error: "no_operator", message: "site.operatorEmail is not set; use npm run credits -- grant." },
      { status: 409 },
    );
  }

  const created = await createAdminGrant(username, credits);
  if (!created) return Response.json({ error: "unavailable" }, { status: 503 });

  const approveUrl = `${serverSite().url}/${username}/payment/${created.payment.id}/approve/${created.token}`;
  const mail = renderMail(
    operator,
    `Approve credit grant — ${username} — ${credits} credits`,
    {
      preheader: `${credits} credits for ${username}, granted by hand`,
      title: "A credit grant is waiting for you to approve",
      blocks: [
        {
          kind: "paragraph",
          text: `${credits} credits were requested for ${username} from the operator dashboard. No money is involved; this is a grant by hand.`,
        },
        {
          kind: "paragraph",
          text: "Open the link below and accept it to add the credits to their balance. The link works once.",
        },
        { kind: "button", text: "Review and approve", href: approveUrl },
      ],
      footer: "You are receiving this because you are the operator of this Fernscout instance.",
    },
    username,
  );
  await sendTransactional(mail, "admin credit grant approval");

  // Never "granted". A mail is waiting, and that is the whole of what happened.
  return Response.json({ ok: true, status: "requested", credits, creditsAdded: 0 });
}
