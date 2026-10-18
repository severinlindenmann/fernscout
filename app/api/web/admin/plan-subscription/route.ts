import { withV2Log } from "@/lib/api/v2/route";
import { POST as POST_ } from "@paid/billing/routes/api/web/admin/plan-subscription/route";
export const POST = withV2Log(POST_, { route: "/api/web/admin/plan-subscription" });
export const dynamic = "force-dynamic";
