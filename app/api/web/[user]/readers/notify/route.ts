import { readJsonBody } from "@/lib/api/jsonBody";
import { INVITE_CHANNELS, inviteOptions, sendInvite, type InviteChannel } from "@/lib/contacts/welcome";
import { ownerOnly, PRIVATE } from "@/lib/readers/ownerDoor";

export const dynamic = "force-dynamic";

/**
 * Step 2 of "Add a person", and every "Resend" / "Send again" on a card —
 * B2292 (B2291 "Credits").
 *
 * `GET ?contactId=` answers what each channel would do: usable or why not,
 * what it costs, the balance, and the exact message the person would get.
 * Sends nothing.
 *
 * `POST { contactId, channel: "email" | "sms" | "self" }` sends on that one
 * channel. SMS takes one credit on this press and gives it back when the
 * send fails; a short balance is refused (402) with nothing charged. `self`
 * sends nothing and answers the link. WhatsApp retired as an invite
 * channel, B2339.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/web/[user]/readers/notify">) {
  const { user } = await params;
  const denied = await ownerOnly(request, user);
  if (denied) return denied;
  const contactId = new URL(request.url).searchParams.get("contactId") ?? "";
  const options = contactId ? await inviteOptions(user, contactId) : null;
  if (!options) return Response.json({ error: "no_contact" }, { status: 404, headers: PRIVATE });
  return Response.json({ ok: true, ...options }, { headers: PRIVATE });
}

const STATUS: Record<string, number> = {
  no_contact: 404,
  no_credits: 402,
  rate_limited: 429,
  daily_limit: 429,
  send_failed: 502,
};

export async function POST(request: Request, { params }: RouteContext<"/api/web/[user]/readers/notify">) {
  const { user } = await params;
  const denied = await ownerOnly(request, user);
  if (denied) return denied;

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = jsonBody.value as Record<string, unknown> | null;
  const contactId = typeof body?.contactId === "string" ? body.contactId : "";
  const channel = body?.channel as InviteChannel;
  if (!contactId) {
    return Response.json({ error: "invalid_request", message: "contactId is required." }, { status: 400 });
  }
  if (!INVITE_CHANNELS.includes(channel)) {
    // B2339 — WhatsApp is retired as an invite channel; naming the accepted
    // set rather than a bare "invalid_request" is what lets a caller that
    // still asks for it (an old client, or an agent guessing) learn why
    // without reading source.
    return Response.json(
      { error: "invalid_request", message: `channel "${String(channel)}" is not one of: ${INVITE_CHANNELS.join(", ")}.` },
      { status: 400 },
    );
  }

  const result = await sendInvite(user, contactId, channel);
  if (!result.ok) {
    return Response.json(
      { error: result.reason, ...(result.balance !== undefined ? { balance: result.balance } : {}) },
      { status: STATUS[result.reason] ?? 409, headers: PRIVATE },
    );
  }
  return Response.json(result, { headers: PRIVATE });
}
