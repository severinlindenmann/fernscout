import { withV2Log } from "@/lib/api/v2/route";
import { POST as paidPOST } from "@paid/photobook/routes/api/helper/[user]/photobook/route";
export const POST = withV2Log(paidPOST, { route: "/api/helper/[user]/photobook" });
export const dynamic = "force-dynamic";
