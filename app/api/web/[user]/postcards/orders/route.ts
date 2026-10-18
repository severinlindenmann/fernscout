import { withV2Log } from "@/lib/api/v2/route";
import { POST as paidPOST } from "@paid/postcard/routes/api/web/[user]/postcards/orders/route";
export const POST = withV2Log(paidPOST, { route: "/api/web/[user]/postcards/orders" });
export const dynamic = "force-dynamic";
