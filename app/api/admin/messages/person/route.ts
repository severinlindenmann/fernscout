import { isInstanceAdmin } from "@/lib/adminGate";
import { listMessages, recipientHash } from "@/lib/messages/log";

export const dynamic = "force-dynamic";

/**
 * Who got what — B2441's Person tab. The operator types an email or phone;
 * this hashes it the same way `logMessage` hashed it on the way in
 * (`recipientHash`) and looks the hash up. **The raw address never reaches
 * a response, a log line or this route's own memory beyond the one lookup**
 * — only `recipient_mask` (already masked before it was written) comes
 * back, exactly as `message_log` itself never stores more.
 */
export async function GET(request: Request) {
  if (!(await isInstanceAdmin())) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("query") ?? "").trim();
  if (!query) return Response.json({ rows: [] });

  const hash = recipientHash(query);
  const rows = await listMessages({ hash, limit: 200 });
  return Response.json({
    rows: rows.map((r) => ({
      id: r.id,
      template: r.template,
      channel: r.channel,
      flow: r.flow,
      recipientMask: r.recipientMask,
      locale: r.locale,
      status: r.status,
      reason: r.reason,
      createdAt: r.createdAt,
    })),
  });
}
