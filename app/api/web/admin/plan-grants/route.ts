import { withV2Log } from "@/lib/api/v2/route";
import { GET as paidGET, POST as paidPOST, DELETE as paidDELETE, PATCH as paidPATCH } from "@paid/billing/routes/api/web/admin/plan-grants/route";
export const GET = withV2Log(paidGET, { route: "/api/web/admin/plan-grants" });
export const POST = withV2Log(paidPOST, { route: "/api/web/admin/plan-grants" });
export const DELETE = withV2Log(paidDELETE, { route: "/api/web/admin/plan-grants" });
export const PATCH = withV2Log(paidPATCH, { route: "/api/web/admin/plan-grants" });
export const dynamic = "force-dynamic";
