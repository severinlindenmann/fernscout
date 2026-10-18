import { withV2Log } from "@/lib/api/v2/route";
import { POST as paidPOST } from "@paid/billing/routes/api/web/[user]/apple/verify-purchase/route";
export const POST = withV2Log(paidPOST, { route: "/api/web/[user]/apple/verify-purchase" });
