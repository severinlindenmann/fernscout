import { isInstanceAdmin } from "@/lib/adminGate";
import { listMessages, MESSAGE_STATUSES, type MessageStatus } from "@/lib/messages/log";

export const dynamic = "force-dynamic";

/** Newest send-log rows, filtered by status — B2441's Log tab. Masked
 * recipient only, never a body, exactly what `message_log` itself holds. */
export async function GET(request: Request) {
  if (!(await isInstanceAdmin())) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const validStatus = status && (MESSAGE_STATUSES as readonly string[]).includes(status) ? (status as MessageStatus) : undefined;

  const rows = await listMessages({ status: validStatus, limit: 200 });
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
