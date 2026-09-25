// GET /api/v2/status — the instance, not a journal. No auth — B1608.
import { instanceStatus } from "@/lib/api/v2/schemas";
import { ok } from "@/lib/api/v2/route";
import { buildInstanceStatus } from "@/lib/api/v2/status";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok(instanceStatus.parse(buildInstanceStatus()));
}
