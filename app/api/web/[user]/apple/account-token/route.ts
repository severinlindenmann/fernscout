import { withV2Log } from "@/lib/api/v2/route";
import { GET as paidGET } from "@paid/billing/routes/api/web/[user]/apple/account-token/route";
export const GET = withV2Log(paidGET, { route: "/api/web/[user]/apple/account-token" });
