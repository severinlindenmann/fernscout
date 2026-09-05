import { NextResponse } from "next/server";
import { resolveAccess } from "@/lib/auth/handshake";
import { isEnabled } from "@/lib/capabilities";
import { findActiveContactId, removeSubscription, saveSubscription } from "@/lib/push";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

function usernameOf(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Push is on for a request only when the server can provide it and this
 * particular journal has opted in — the same rule every capability follows
 * (`lib/capabilities.ts`). */
function pushEnabledFor(username: string | null): boolean {
  return Boolean(username && getUser(username) && isEnabled("push", username));
}

/** Hands the browser the public VAPID key it needs to subscribe, for one
 * journal. With push off — server-wide or just for this user — this answers
 * `enabled: false` and no key, which is what lets `PushOptIn` render nothing. */
export async function GET(request: Request) {
  const username = usernameOf(new URL(request.url).searchParams.get("user"));
  const enabled = pushEnabledFor(username);
  return NextResponse.json(
    { publicKey: enabled ? (process.env.VAPID_PUBLIC_KEY ?? null) : null, enabled },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!rateLimit(clientIp(request)).ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { user?: unknown; endpoint?: unknown; keys?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const username = usernameOf(body.user);
  if (!username || !pushEnabledFor(username)) {
    return NextResponse.json({ error: "push_disabled" }, { status: 404 });
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const keys = body.keys as { p256dh?: unknown; auth?: unknown } | undefined;
  const p256dh = typeof keys?.p256dh === "string" ? keys.p256dh : "";
  const auth = typeof keys?.auth === "string" ? keys.auth : "";

  // Endpoints are push-service URLs; anything else is junk or an attempt to
  // make us POST somewhere arbitrary later.
  if (!endpoint.startsWith("https://") || endpoint.length > 800 || !p256dh || !auth) {
    return NextResponse.json({ error: "bad_subscription" }, { status: 400 });
  }

  // A subscriber who is also signed in as an approved contact gets tied to
  // that record, so a closed trip's notifications can be scoped to people who
  // can actually read it (`lib/push.ts#subscribersFor`).
  // Nobody else's subscription is any less valid for a public or unlisted
  // trip — it just can't be scoped to a restricted one.
  // Either browser credential (B410). A reader who arrived on an instance-wide
  // identity is exactly as approved as one holding this journal's own session
  // — `findActiveContactId` asks the contacts table, which is the same
  // question for both — and missing them here would quietly drop them out of
  // the per-recipient fan-out that keeps a closed trip's notification off the
  // wrong lock screen.
  const { email } = await resolveAccess(username);
  const contactId = email ? await findActiveContactId(username, email) : null;

  await saveSubscription({
    username,
    endpoint,
    keys: { p256dh, auth },
    created: new Date().toISOString().slice(0, 10),
    agent: (request.headers.get("user-agent") ?? "").slice(0, 120),
    contactId,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  let body: { user?: unknown; endpoint?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const username = usernameOf(body.user);
  if (!username || typeof body.endpoint !== "string") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  await removeSubscription(username, body.endpoint);
  return NextResponse.json({ ok: true });
}
