import { withV2Log } from "@/lib/api/v2/route";
import { POST as paidPOST } from "@paid/postcard/routes/api/helper/[user]/postcard/route";
export const POST = withV2Log(paidPOST, { route: "/api/helper/[user]/postcard" });
export const dynamic = "force-dynamic";
