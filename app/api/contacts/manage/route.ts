import { isEnabled } from "@/lib/capabilities";
import {
  deleteContactSelf,
  resolveManageToken,
  unsubscribeContact,
  updateContactSelf,
  type ContactRecord,
} from "@/lib/contacts";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The self-serve page (C13), and the GDPR/DSG delete path with it.
 *
 * No login, no password: the token in the URL is the credential. That is a
 * deliberate trade. The alternative — "sign in to unsubscribe" — is how mail
 * ends up marked as spam by the very people it was written for, and the token
 * can do nothing but read, edit and delete the one row it names.
 *
 * What it returns includes the postal address, because the person asking is the
 * person it belongs to and they have to be able to correct it. That is the only
 * route besides the owner's own that ever decrypts one.
 */

function selfView(contact: ContactRecord) {
  return {
    name: contact.name,
    email: contact.email,
    locale: contact.locale,
    status: contact.status,
    wantsEmailDigest: contact.wantsEmailDigest,
    wantsPostcard: contact.wantsPostcard,
    wantsWhatsapp: contact.wantsWhatsapp,
    address: contact.postalAddress,
    confirmedAt: contact.confirmedAt,
  };
}

function limited(request: Request) {
  const limit = rateLimitFor("contacts-manage", clientIp(request), {
    max: 40,
    windowMs: 15 * 60 * 1000,
  });
  return limit.ok
    ? null
    : Response.json(
        { error: "too_many_requests", retryAfter: limit.retryAfter },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const username = url.searchParams.get("user") ?? "";
  if (!getUser(username) || !isEnabled("contacts", username)) {
    return Response.json({ error: "contacts_disabled" }, { status: 404 });
  }
  const throttled = limited(request);
  if (throttled) return throttled;

  const contact = await resolveManageToken(username, url.searchParams.get("token") ?? "");
  if (!contact) return Response.json({ error: "unknown_token" }, { status: 404 });
  return Response.json({ contact: selfView(contact) });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.user === "string" ? body.user : "";
  if (!getUser(username) || !isEnabled("contacts", username)) {
    return Response.json({ error: "contacts_disabled" }, { status: 404 });
  }
  const throttled = limited(request);
  if (throttled) return throttled;

  const token = typeof body.token === "string" ? body.token : "";
  const action = typeof body.action === "string" ? body.action : "update";

  if (action === "delete") {
    const gone = await deleteContactSelf(username, token);
    if (!gone) return Response.json({ error: "unknown_token" }, { status: 404 });
    return Response.json({ ok: true, deleted: true });
  }

  if (action === "unsubscribe") {
    const done = await unsubscribeContact(username, token);
    if (!done) return Response.json({ error: "unknown_token" }, { status: 404 });
    return Response.json({ ok: true });
  }

  if (action !== "update") {
    return Response.json({ error: "unknown_action" }, { status: 400 });
  }

  const contact = await updateContactSelf(username, token, {
    name: typeof body.name === "string" ? body.name : undefined,
    locale: typeof body.locale === "string" ? body.locale : undefined,
    address:
      body.address === undefined
        ? undefined
        : typeof body.address === "object" && body.address !== null
          ? (body.address as Record<string, unknown>)
          : null,
    // `wantsEmailDigest` is the name; `wantsDigest` is the one this endpoint
    // used to take on its own, still read so existing clients keep working.
    // See the note in ../request/route.ts.
    wantsEmailDigest:
      typeof body.wantsEmailDigest === "boolean"
        ? body.wantsEmailDigest
        : typeof body.wantsDigest === "boolean"
          ? body.wantsDigest
          : undefined,
    wantsPostcard: typeof body.wantsPostcard === "boolean" ? body.wantsPostcard : undefined,
    wantsWhatsapp: typeof body.wantsWhatsapp === "boolean" ? body.wantsWhatsapp : undefined,
  });

  if (!contact) return Response.json({ error: "unknown_token" }, { status: 404 });
  return Response.json({ ok: true, contact: selfView(contact) });
}
