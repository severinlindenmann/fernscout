import { withV2Log } from "@/lib/api/v2/route";
import { GET as paidGET, POST as paidPOST, DELETE as paidDELETE } from "@paid/billing/routes/api/web/admin/vouchers/route";
export const GET = withV2Log(paidGET, { route: "/api/web/admin/vouchers" });
export const POST = withV2Log(paidPOST, { route: "/api/web/admin/vouchers" });
export const DELETE = withV2Log(paidDELETE, { route: "/api/web/admin/vouchers" });
export const dynamic = "force-dynamic";
