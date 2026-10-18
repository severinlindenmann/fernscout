import { withV2Log } from "@/lib/api/v2/route";
import { POST as paidPOST } from "@paid/billing/routes/api/web/admin/plan-subscription/route";
export const POST = withV2Log(paidPOST, { route: "/api/web/admin/plan-subscription" });
export const dynamic = "force-dynamic";
