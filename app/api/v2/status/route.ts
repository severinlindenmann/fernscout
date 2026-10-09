// GET /api/v2/status — the instance, not a journal. No auth — B1608.
import { instanceStatus } from "@/lib/api/v2/schemas";
import { ok, withV2Log } from "@/lib/api/v2/route";
import { buildInstanceStatus } from "@/lib/api/v2/status";

export const dynamic = "force-dynamic";

export const GET = withV2Log(async function GET() {
  return ok(instanceStatus.parse(buildInstanceStatus()));
}, { route: "/api/v2/status" });
