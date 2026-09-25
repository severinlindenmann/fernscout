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

/** `"web"` (a browser's Push API) or `"apns"` (the iPhone shell, B2115) —
 * anything else defaults to `"web"`, which is every caller that predates the
 * shell and never sent the field at all. */
function kindOf(value: unknown): "web" | "apns" {
  return value === "apns" ? "apns" : "web";
}

/** Push is on for a request only when the server can provide it and this
 * particular journal has opted in — the same rule every capability follows
 * (`lib/capabilities.ts`). Each transport is its own capability
 * (`push` for web, `applePush` for the shell — see lib/config.ts), so one
 * being on says nothing about the other. */
function pushEnabledFor(username: string | null, kind: "web" | "apns"): boolean {
  return Boolean(username && getUser(username) && isEnabled(kind === "apns" ? "applePush" : "push", username));
}

/** Hands the browser the public VAPID key it needs to subscribe, for one
 * journal (`kind=apns` needs no key — the shell registers with Apple
 * directly). With the transport off — server-wide or just for this user —
 * this answers `enabled: false` and no key, which is what lets `PushOptIn`
 * render nothing (or, in the shell, report "unavailable" honestly). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const username = usernameOf(url.searchParams.get("user"));
  const kind = kindOf(url.searchParams.get("kind"));
  const enabled = pushEnabledFor(username, kind);
  return NextResponse.json(
    { publicKey: enabled && kind === "web" ? (process.env.VAPID_PUBLIC_KEY ?? null) : null, enabled },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!rateLimit(clientIp(request)).ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { user?: unknown; endpoint?: unknown; keys?: unknown; kind?: unknown; token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const username = usernameOf(body.user);
  const kind = kindOf(body.kind);
  if (!username || !pushEnabledFor(username, kind)) {
    return NextResponse.json({ error: "push_disabled" }, { status: 404 });
  }

  let endpoint: string;
  let p256dh: string;
  let auth: string;
  if (kind === "apns") {
    // The shell's own registration (B2115): a device token, no push-service
    // URL and no encryption keypair — see `StoredSubscription` in
    // lib/repos/types.ts. APNs tokens are hex, and vary a little in length
    // across iOS versions and environments; this checks shape, not an exact
    // count.
    const token = typeof body.token === "string" ? body.token : "";
    if (!/^[0-9a-fA-F]{32,200}$/.test(token)) {
      return NextResponse.json({ error: "bad_subscription" }, { status: 400 });
    }
    endpoint = token;
    p256dh = "";
    auth = "";
  } else {
    endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    const keys = body.keys as { p256dh?: unknown; auth?: unknown } | undefined;
    p256dh = typeof keys?.p256dh === "string" ? keys.p256dh : "";
    auth = typeof keys?.auth === "string" ? keys.auth : "";
    // Endpoints are push-service URLs; anything else is junk or an attempt
    // to make us POST somewhere arbitrary later.
    if (!endpoint.startsWith("https://") || endpoint.length > 800 || !p256dh || !auth) {
      return NextResponse.json({ error: "bad_subscription" }, { status: 400 });
    }
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
  //
  // The shell carries this journal's own owner cookie whenever the studio is
  // open in it (`components/nativeShell.ts`'s calls all ride the same
  // WKWebView cookie jar), so `resolveAccess` answers exactly as it does for
  // a browser tab — no separate credential path for `kind: "apns"`.
  const { email } = await resolveAccess(username);
  const contactId = email ? await findActiveContactId(username, email) : null;

  await saveSubscription({
    username,
    endpoint,
    keys: { p256dh, auth },
    created: new Date().toISOString().slice(0, 10),
    agent: (request.headers.get("user-agent") ?? "").slice(0, 120),
    contactId,
    kind,
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
