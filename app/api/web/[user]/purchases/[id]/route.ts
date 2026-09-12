// "Buy credits" — B1622, phase 2 step 4 (money.md §2.2), the account page's
// own slider. Owner cookie only; the bearer-token door onto the same
// `createPurchase` is app/api/v2/[user]/purchases/[id]/route.ts.
//
// PUT, client-chosen id (S2/V10): the same id with the same `credits` is a
// no-op re-read (200, no second mail); a different `credits` is a 409
// naming the stored purchase. `purchaseCreate` is the one schema both this
// door and the bearer door validate against (T5).
import { creditsEnabled } from "@/lib/credits";
import { createPurchase, toPurchaseDoc } from "@/lib/payments";
import { discountFor, discountLabel, formatChf, priceRappen } from "@/lib/credits/pricing";
import { purchaseCreate, purchaseDoc } from "@/lib/api/v2/schemas";
import { isOwner } from "@/lib/contacts/session";
import { sendTransactional } from "@/lib/mail";
import { renderMail } from "@/lib/mail/template";
import { pickLocale } from "@/lib/contacts/locale";
import { translateIn } from "@/lib/locales";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

async function mailOwner(user: string, id: string, credits: number): Promise<void> {
  const journal = getUser(user);
  const to = journal?.owner.email;
  if (!journal || !to) return;

  const base = serverSite().url;
  const payUrl = `${base}/${user}/payment/${id}`;
  const price = formatChf(priceRappen(credits));
  const locale = pickLocale(journal.defaultLocale);
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) => translateIn(locale, key, vars);
  const discount = discountFor(credits) > 0 ? t("mail.buyDiscount", { label: discountLabel(credits) }) : "";
  const vars = { credits: String(credits), price, discount, id, user };

  const mail = renderMail(
    to,
    t("mail.buySubject", vars),
    {
      preheader: t("mail.buyPreheader", vars),
      title: t("mail.buyTitle"),
      blocks: [
        { kind: "paragraph", text: t("mail.buyBody", vars) },
        { kind: "paragraph", text: t("mail.buyHow") },
        { kind: "button", text: t("mail.buyGo"), href: payUrl },
      ],
      footer: t("mail.buyFooter", vars),
    },
    user,
  );
  await sendTransactional(mail, "credit purchase inquiry");
}

export async function PUT(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/purchases/[id]">,
) {
  const { user, id } = await params;

  const journal = getUser(user);
  if (!journal || !creditsEnabled()) {
    return Response.json(
      { error: "credits_disabled", message: "This server does not charge for sends, so there is nothing to buy." },
      { status: 404 },
    );
  }

  if (!(await isOwner(user, request))) {
    return Response.json(
      {
        error: "forbidden",
        message: "Only the address that owns this journal may ask for more credits — not a guest, and not a token scoped to one of its trips.",
      },
      { status: 403 },
    );
  }

  const limit = rateLimitFor("credits-purchase", clientIp(request), { max: 5, windowMs: 60 * 1000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = await request.json().catch(() => null);
  const result = purchaseCreate.safeParse(body);
  if (!result.success) {
    return Response.json(
      {
        error: "invalid_amount",
        message: "Ask for a whole number of credits in the range and step this server sells.",
      },
      { status: 400 },
    );
  }
  const { credits } = result.data;

  const to = journal.owner.email;
  if (!to) return Response.json({ error: "no_owner_address" }, { status: 409 });

  const created = await createPurchase(user, id, credits);
  if (!created.ok) {
    if (created.reason === "no_database") {
      return Response.json({ error: "no_database", message: "This server cannot record a transaction." }, { status: 503 });
    }
    return Response.json(
      {
        error: "conflict",
        message: "That id is already in use for a different amount, or another journal's own purchase.",
        current: created.payment ? purchaseDoc.parse(toPurchaseDoc(created.payment, to, serverSite().url)) : undefined,
      },
      { status: 409 },
    );
  }

  if (created.created) await mailOwner(user, id, credits);

  return Response.json(purchaseDoc.parse(toPurchaseDoc(created.payment, to, serverSite().url)), {
    status: created.created ? 201 : 200,
  });
}
