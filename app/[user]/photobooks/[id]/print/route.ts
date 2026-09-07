import { isOwner } from "@/lib/contacts/session";
import { printOrder } from "@/lib/photobook/print";

export const dynamic = "force-dynamic";

/**
 * The button. The only thing in this codebase that puts a photobook order
 * through to Gelato — B434's counterpart for a printed book.
 *
 * Same three things make this the door an agent cannot open, for the same
 * reasons `app/[user]/postcards/[id]/send/route.ts` states them:
 *
 * - **Not under `/api/v1/`** — that prefix is the agent's namespace.
 * - **The owner's cookie and nothing else** — `isOwner` is called without the
 *   request, so only a browser session or identity cookie satisfies it.
 * - **A bearer token is refused outright**, with a reason, rather than falling
 *   through to the cookie check.
 *
 * A `<form method="post">` on the order page, and the response is a redirect
 * back to it — no client component, no fetch. Two presses are not a problem:
 * `claimForPrint` is a conditional update, so the second one changes no row
 * and prints nothing.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/[user]/photobooks/[id]/print">,
) {
  const { user, id } = await params;

  if (request.headers.get("authorization")) {
    return Response.json(
      {
        error: "not_for_agents",
        message:
          "A photobook is sent to the printer by the person whose journal it is, from the order " +
          "page, and never by an agent holding a token. Give them the URL of the order and stop " +
          "— nothing has been printed or charged.",
      },
      { status: 403 },
    );
  }

  if (!(await isOwner(user))) {
    return backTo(user, id, "forbidden");
  }

  const form = await request.formData();
  const quotedCredits = Number(form.get("quotedCredits"));
  if (!Number.isInteger(quotedCredits) || quotedCredits <= 0) {
    return backTo(user, id, "stale_quote");
  }

  const outcome = await printOrder(user, id, quotedCredits);
  return backTo(user, id, outcome.ok ? "printed" : outcome.reason);
}

function backTo(user: string, id: string, result: string): Response {
  const location =
    `/${encodeURIComponent(user)}/photobooks/${encodeURIComponent(id)}` +
    `?print=${encodeURIComponent(result)}#print`;
  // 303 so the browser follows with a GET: reloading the order page must not
  // repost the form, which would be a second attempt to print and charge.
  return new Response(null, { status: 303, headers: { Location: location } });
}
