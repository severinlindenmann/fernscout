// GET/PUT /api/v2/{user}/postcards/orders/{id} — B1624, phase 2 step 4.
// docs/plans/2026-09-12-api-v2/print.md §2.1-2.2.
//
// PUT is the only agent-facing write in this whole area — it proposes an
// order, charges nothing and prints nothing. There is deliberately no send
// door anywhere under /api/v2 or /api/v1: that is
// app/api/web/[user]/postcards/orders/[id]/send/route.ts's job, cookie-only,
// and nothing here imports the domain send function (lib/postcard/send.ts).
import { balanceOf, creditsEnabled } from "@/lib/credits";
import { postcardOrderDoc, postcardOrderWrite } from "@/lib/api/v2/schemas";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { etagFor, fail, ifMatchStale, ok, readDryRun, readJson } from "@/lib/api/v2/route";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { postcardsReady } from "@/lib/api/v2/postcards";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import {
  createOrder,
  getOrder,
  isExpired,
  orderCost,
  ORDER_TTL_MS,
  resolvePostcardInput,
  type PostcardOrder,
} from "@/lib/postcard/orders";
import { serverSite } from "@/lib/site";

export const dynamic = "force-dynamic";

function docFor(user: string, order: PostcardOrder) {
  const expired = order.status === "draft" && isExpired(order);
  const status = expired ? "expired" : order.status;
  const source =
    order.payload.trip && order.payload.day
      ? { trip: order.payload.trip.split("/").slice(1).join("/"), day: order.payload.day, photo: order.payload.photo }
      : { inbox: order.payload.photo };
  return postcardOrderDoc.parse({
    source,
    message: order.payload.message,
    from: order.payload.from,
    recipients: order.payload.recipients,
    locale: order.payload.locale,
    ...(order.payload.crop ? { crop: order.payload.crop } : {}),
    ...(order.payload.figures !== undefined ? { figures: order.payload.figures } : {}),
    id: order.id,
    status,
    url: `${serverSite().url}/${user}/postcards/${order.id}`,
    credits: {
      each: order.payload.creditsEach,
      total: orderCost(order),
      balance: null,
    },
    expiresAt: order.payload.expiresAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    ...(order.payload.results
      ? {
          results: order.payload.results.map((r) => ({
            contactId: r.contactId,
            ok: r.ok,
            ...(r.error ? { error: r.error } : {}),
            ...(r.providerStatus ? { providerStatus: r.providerStatus } : {}),
          })),
        }
      : {}),
  });
}

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/postcards/orders/[id]">,
) {
  const { user, id } = await params;
  const ready = postcardsReady(user);
  if (!ready.ok) return ready.response;

  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;

  const order = await getOrder(user, id);
  if (!order) return fail("unknown_order", ERROR_CODES.unknown_order, undefined, 404);

  const doc = docFor(user, order);
  doc.credits.balance = creditsEnabled() ? await balanceOf(user) : null;
  return ok(doc, { etag: etagFor(doc) });
}

/**
 * PUT's own logic, apart from who is asking — B1674, the same split
 * `invitePutResponse` (app/api/v2/[user]/invites/[id]/route.ts) uses. Called
 * here after `postcardsReady` + `requireJournalOwner` (bearer), and by
 * `app/api/web/[user]/postcards/orders/route.ts` after its own cookie-only
 * check plus the same `postcardsReady` — a v2 route file cannot import a
 * sibling's glue, so this is where the two doors share it.
 *
 * PUT is the create door (S2/V10) — client-chosen id. A retried create (no
 * `If-Match`, and an id that already exists) answers `stale_document` (409)
 * with the stored document, the same shape every other client-chosen-id
 * create in v2 uses.
 */
export async function postcardOrderPutResponse(
  user: string,
  id: string,
  request: Request,
): Promise<Response> {
  const existing = await getOrder(user, id);
  if (existing) {
    const doc = docFor(user, existing);
    if (!request.headers.get("if-match")) {
      return fail(
        "stale_document",
        "An order with this id already exists. Read it back, then PUT again with If-Match " +
          "set to its ETag if you meant to replace it — though nothing about a postcard " +
          "order is ever replaced in practice; propose a new id instead.",
        { current: doc },
        409,
      );
    }
    if (ifMatchStale(request, etagFor(doc))) {
      return fail("stale_document", "This order changed since it was last read.", { current: doc }, 409);
    }
    // Nothing about an existing order is actually re-writable through this
    // door (crop/message/recipients are the owner's own PATCH, §2.4) — a
    // matching If-Match simply echoes what is already there.
    return ok(doc, { etag: etagFor(doc) });
  }

  const dryRun = readDryRun(request);
  if (dryRun === null) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} dryRun must be true, false, or absent.`, undefined, 400);
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} The body must be a JSON object.`, undefined, 400);
  }

  const result = postcardOrderWrite.safeParse(body);
  if (!result.success) {
    return fail("invalid_request", ERROR_CODES.invalid_request, problemsFrom(result.error), 400);
  }
  const write = result.data;

  // Resolve the source, the recipient list and the provider — the one
  // shared check `resolvePostcardInput` runs for every caller that proposes
  // an order (B1650): a trip's own photograph or one staged in the inbox,
  // recipients that are actually on the approved list, and the configured
  // provider.
  const resolved = await resolvePostcardInput(user, write);
  if (!resolved.ok) {
    switch (resolved.error) {
      case "unknown_photo":
        return fail("unknown_photo", ERROR_CODES.unknown_photo, undefined, 404);
      case "unknown_trip":
        return fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404);
      case "unknown_day":
        return fail("unknown_day", ERROR_CODES.unknown_day, undefined, 404);
      case "test_content":
        return fail("test_content", ERROR_CODES.test_content, undefined, 400);
      case "unknown_recipient":
        return fail("unknown_recipient", ERROR_CODES.unknown_recipient, { unknown: resolved.unknown }, 404);
    }
  }
  const { input: resolvedInput } = resolved;

  if (dryRun) {
    const now = new Date().toISOString();
    const preview: PostcardOrder = {
      id,
      owner: user,
      status: "draft",
      provider: resolvedInput.provider,
      payload: {
        trip: resolvedInput.trip,
        day: resolvedInput.day,
        photo: resolvedInput.photo,
        message: resolvedInput.message,
        from: resolvedInput.from,
        recipients: resolvedInput.recipients,
        locale: resolvedInput.locale,
        creditsEach: 0,
        expiresAt: new Date(Date.now() + ORDER_TTL_MS).toISOString(),
        ...(resolvedInput.crop ? { crop: resolvedInput.crop } : {}),
        ...(resolvedInput.figures !== undefined ? { figures: resolvedInput.figures } : {}),
      },
      createdAt: now,
      updatedAt: now,
    };
    return ok(docFor(user, preview));
  }

  const order = await createOrder(user, { ...resolvedInput, id });
  if (!order) return fail("no_database", ERROR_CODES.no_database, undefined, 503);

  const doc = docFor(user, order);
  return ok(
    {
      ...doc,
      credits: { ...doc.credits, balance: creditsEnabled() ? await balanceOf(user) : null },
      next: "Nothing has been printed or charged. Ask the owner to open the URL and press Send.",
    },
    { status: 201, etag: etagFor(doc) },
  );
}

export async function PUT(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/postcards/orders/[id]">,
) {
  const { user, id } = await params;
  const ready = postcardsReady(user);
  if (!ready.ok) return ready.response;

  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;

  return postcardOrderPutResponse(user, id, request);
}
