// GET/PUT one purchase — B1622, phase 2 step 4 (money.md §2.2), replacing
// app/api/v1/[user]/credits/purchase/route.ts.
//
// PUT is the create door (S2/V10), client-chosen id: same id + same
// `credits` is a no-op re-read (200, no mail); same id + a different
// `credits` is a `conflict` (409) naming the stored document. Bearer,
// owner-scope only — a trip-scoped token cannot see the balance on
// `journalStatus` either, so it cannot propose spending it.
//
// **This route grants nothing and mails nobody but the owner.** It records a
// pending transaction and mails an absolute link to `journal.owner.email`;
// paying happens at `/api/web/{user}/purchases/{id}/pay`, and only the
// operator's approval or Stripe's signed webhook ever raises a balance.
import { creditsEnabled } from "@/lib/credits";
import { createPurchase, getPayment, toPurchaseDoc } from "@/lib/payments";
import { discountFor, discountLabel, formatChf, priceRappen } from "@/lib/credits/pricing";
import { purchaseCreate, purchaseDoc } from "@/lib/api/v2/schemas";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { etagFor, fail, ok, readDryRun, readJson } from "@/lib/api/v2/route";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";
import { sendTransactional } from "@/lib/mail";
import { renderMail } from "@/lib/mail/template";
import { pickLocale } from "@/lib/contacts/locale";
import { translateIn } from "@/lib/locales";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

function creditsGate(user: string): Response | null {
  if (!getUser(user) || !creditsEnabled()) {
    return fail("credits_disabled", ERROR_CODES.credits_disabled, undefined, 404);
  }
  return null;
}

export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/purchases/[id]">) {
  const { user, id } = await params;
  const gate = creditsGate(user);
  if (gate) return gate;

  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;

  const payment = await getPayment(user, id);
  if (!payment) return fail("unknown_payment", ERROR_CODES.unknown_payment, undefined, 404);

  const journal = getUser(user)!;
  const doc = purchaseDoc.parse(toPurchaseDoc(payment, journal.owner.email ?? "", serverSite().url));
  return ok(doc, { etag: etagFor(doc) });
}

/**
 * Mail the owner the same "a purchase is waiting" mail v1 sent — B405/B792,
 * unchanged in wording. Only sent when `createPurchase` actually inserted a
 * new row; a retried PUT that matched an existing one mails nothing again.
 */
async function mailOwner(user: string, id: string, credits: number): Promise<string | null> {
  const journal = getUser(user);
  const to = journal?.owner.email;
  if (!to) return null;

  const base = serverSite().url;
  const payUrl = `${base}/${user}/payment/${id}`;
  const price = formatChf(priceRappen(credits));
  const locale = pickLocale(journal!.defaultLocale);
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
  return to;
}

export async function PUT(request: Request, { params }: RouteContext<"/api/v2/[user]/purchases/[id]">) {
  const { user, id } = await params;
  const gate = creditsGate(user);
  if (gate) return gate;

  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;

  // Authenticated and owner-scope, so this is a stuck client rather than an
  // attacker enumerating anything — the same bucket v1's route used.
  const limit = rateLimitFor("credits-purchase", clientIp(request), { max: 5, windowMs: 60 * 1000 });
  if (!limit.ok) {
    return fail("too_many_requests", ERROR_CODES.too_many_requests, { retryAfter: limit.retryAfter }, 429);
  }

  const dryRun = readDryRun(request);
  if (dryRun === null) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} dryRun must be true, false, or absent.`, undefined, 400);
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const result = purchaseCreate.safeParse(parsed.value);
  if (!result.success) {
    return fail("invalid_amount", ERROR_CODES.invalid_amount, problemsFrom(result.error), 400);
  }
  const { credits } = result.data;

  const journal = getUser(user)!;
  const to = journal.owner.email;
  if (!to) return fail("no_owner_address", ERROR_CODES.no_owner_address, undefined, 409);

  const created = await createPurchase(user, id, credits, { dryRun: dryRun ?? false });
  if (!created.ok) {
    if (created.reason === "no_database") {
      return fail("no_database", ERROR_CODES.no_database, undefined, 503);
    }
    // A conflict on this owner's own row carries the stored document; one on
    // another journal's row (payments.id is one instance-wide key) carries
    // none, so nothing about a stranger's purchase leaks.
    const details = created.payment
      ? { current: purchaseDoc.parse(toPurchaseDoc(created.payment, to, serverSite().url)) }
      : undefined;
    return fail("conflict", ERROR_CODES.conflict, details, 409);
  }

  if (dryRun) {
    const preview = purchaseDoc.parse(toPurchaseDoc(created.payment, to, serverSite().url));
    return ok(preview, { status: created.created ? 201 : 200, etag: etagFor(preview) });
  }

  if (created.created) await mailOwner(user, id, credits);

  const doc = purchaseDoc.parse(toPurchaseDoc(created.payment, to, serverSite().url));
  return ok(doc, { status: created.created ? 201 : 200, etag: etagFor(doc) });
}
